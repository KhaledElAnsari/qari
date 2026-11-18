import * as ort from 'onnxruntime-web/webgpu';
import { peakNormalize } from '../../audio/peak-normalize';
import type { Backend } from '../../backend/backend-probe';
import { QariError } from '../../errors/qari-error';
import { normalizeForSpeech } from '../../normalization/normalize';
import type { SpokenWord } from '../../normalization/normalize';
import { wordTimingsFromSpans } from '../../timings/word-timings';
import type { WordTimings } from '../../timings/word-timings';
import type { VoiceConfig } from '../../voice/voice-config';
import { groupSentences, lineBreaksAfter } from '../magpie-tts/sentences';
import { createSession } from '../ort-session';
import type { AdapterContext, RuntimeAdapter, SynthesisOptions, SynthesisResult, VoiceModels } from '../runtime-adapter';
import { loadEspeak } from './espeak';
import { cleanWord, fixArticle, shaddaFirst, trimLeadingBreath } from './fixes';
import { NabraG2P, tokenize } from './g2p';
import { parseNabraConfig } from './nabra-config';
import type { NabraConfig } from './nabra-config';

/** Files a kokoro voice lists under `files`, besides `model`. */
export const KOKORO_FILES = ['config', 'voice', 'espeak'] as const;

/** Silence between sentences (as for Bayan). */
const SENTENCE_GAP_SECONDS = 0.2;
/** First grouping, in letters (diacritics don't count); sentences over the model's phoneme limit are split again. */
const MAX_SENTENCE_LETTERS = 220;
/** A take whose waveform isn't finite is made again once (the model draws new noise every run). */
const MAX_TAKES = 2;
const ARABIC_LETTER = /[\u0621-\u064A]/;
const HAS_LETTER_OR_DIGIT = /\p{L}|\p{N}/u;

/** Copies bytes into an aligned Float32Array (the downloaded Uint8Array may start at any offset). */
const toFloat32 = (bytes: Uint8Array) => new Float32Array(bytes.slice().buffer);

/** One sentence ready for the model: token ids, and per token the spoken word (index into the text's words) or −1. */
interface PreparedSentence {
  phonemes: string;
  ids: number[];
  wordOfToken: number[];
}

/**
 * Nabra-82M (Kokoro-82M fine-tuned for MSA, voice af_msa), exported by nabra-onnx/export/export_nabra_onnx.py: one graph,
 * (input_ids, style, speed) → (waveform at 24 kHz, durations in frames per token). Text → phonemes is espeak-ng 1.52.0
 * (WASM, a voice file) with the reference pipeline ported in g2p.ts and Nabra's fixes on top (fixes.ts): shadda,
 * «ال» after a prefix, tripled consonants, darker vowel next to ض ط ص, ع/ح kept, breath before a sentence removed.
 * Word timings come from the model's own durations (timings: "native", ±75 ms at pause edges). `pace` is its speed.
 */
export class KokoroAdapter implements RuntimeAdapter {
  private session: ort.InferenceSession | null = null;
  private config: NabraConfig;
  private styles: Float32Array;
  private g2p: NabraG2P;
  private voice: VoiceConfig;

  constructor(private readonly context: AdapterContext) {}

  async load(voice: VoiceConfig, models: VoiceModels, backend: Backend): Promise<void> {
    const files = models.files ?? {};
    const missing = KOKORO_FILES.filter(name => !files[name]);
    if (missing.length > 0) throw new QariError('voice-unavailable', `Voice ${voice.id} (runtime kokoro) is missing: ${missing.join(', ')}.`);
    try {
      this.config = parseNabraConfig(files.config);
    }
    catch (error) {
      throw new QariError('voice-unavailable', `Voice ${voice.id}: ${error instanceof Error ? error.message : String(error)}.`);
    }
    if (this.config.sample_rate !== voice.sampleRate) {
      throw new QariError('voice-unavailable', `Voice ${voice.id} says ${voice.sampleRate} Hz but its model makes ${this.config.sample_rate} Hz.`);
    }
    this.styles = toFloat32(files.voice);
    if (this.styles.length !== this.config.voice.rows * this.config.voice.dim) {
      throw new QariError('voice-unavailable', `Voice ${voice.id}: the voicepack has ${this.styles.length} values, not ${this.config.voice.rows} × ${this.config.voice.dim}.`);
    }
    this.voice = voice;
    try {
      this.g2p = new NabraG2P(await loadEspeak(files.espeak));
    }
    catch (error) {
      // The voice's espeak-ng.wasm, not the device: say so, rather than let it look like an accelerated-mode failure.
      throw new QariError('voice-unavailable', `Voice ${voice.id}: espeak-ng did not start (${error instanceof Error ? error.message : String(error)}).`);
    }
    this.session = await createSession(models.model, backend);
  }

  useVoice(voice: VoiceConfig): void {
    this.voice = voice;
  }

  async synthesize(text: string, pace: number, options: SynthesisOptions = {}): Promise<SynthesisResult> {
    const session = this.session;
    if (!session) throw new Error('Voice is not loaded yet.');
    const spokenWords = normalizeForSpeech(text, { enabled: options.normalize ?? true });
    const words = spokenWords.map(word => word.text);
    // What espeak gets for each spoken word: no citation marks, no Latin letters (arabic_g2p.normalize_text).
    const cleaned = words.map(cleanWord);
    if (!cleaned.some(word => ARABIC_LETTER.test(word))) throw new QariError('nothing-to-read', 'The text has no Arabic letters the voice can say.');

    const sampleRate = this.config.sample_rate;
    const gap = Math.round(SENTENCE_GAP_SECONDS * sampleRate);
    const parts: Float32Array[] = [];
    const spans: { start: number; end: number }[] = new Array(words.length);
    let samples = 0;
    for (const sentence of this.sentences(words, cleaned, text, spokenWords)) {
      const prepared = this.prepare(sentence, cleaned);
      if (!sentence.some(i => ARABIC_LETTER.test(cleaned[i])) || prepared.ids.length <= 2) {
        const at = samples / sampleRate;
        for (const i of sentence) spans[i] = { start: at, end: at }; // nothing to say: zero-length where the reading is
        continue;
      }
      if (parts.length > 0) samples += gap;
      const { audio, durations } = await this.run(session, prepared, pace);
      trimLeadingBreath(audio, durations[0], this.config.samples_per_frame);
      const start = samples / sampleRate;
      const local = this.wordSpans(sentence, prepared.wordOfToken, durations);
      sentence.forEach((wordIndex, k) => {
        spans[wordIndex] = { start: start + local[k].start, end: start + local[k].end };
      });
      parts.push(audio);
      samples += audio.length;
    }

    const pcm = new Float32Array(samples);
    let at = 0;
    for (const [i, part] of parts.entries()) {
      if (i > 0) at += gap;
      pcm.set(part, at);
      at += part.length;
    }
    return { pcm: peakNormalize(pcm), sampleRate: this.voice.sampleRate, timings: this.wordTimings(text, spokenWords, spans, samples / sampleRate) };
  }

  async dispose(): Promise<void> {
    await this.session?.release();
    this.session = null;
  }

  /** Sentences as word indexes: grouped like Bayan's, then split again while one is over the model's phoneme limit. */
  private sentences(words: string[], cleaned: string[], text: string, spokenWords: SpokenWord[]): number[][] {
    const fits = (sentence: number[]) => sentence.length <= 1 || this.prepare(sentence, cleaned).phonemes.length <= this.config.max_phonemes;
    const split = (sentence: number[]): number[][] => {
      if (fits(sentence)) return [sentence];
      const half = Math.ceil(sentence.length / 2);
      return [...split(sentence.slice(0, half)), ...split(sentence.slice(half))];
    };
    return groupSentences(words, MAX_SENTENCE_LETTERS, lineBreaksAfter(text, spokenWords)).flatMap(split);
  }

  /** Phonemes and token ids for one sentence, each token tagged with the spoken word it came from. */
  private prepare(sentence: number[], cleaned: string[]): PreparedSentence {
    const present = sentence.filter(i => cleaned[i] !== '');
    // The G2P's words are the pieces with a letter or digit, in order: the same filter maps them back to spoken words.
    const timed = present.filter(i => HAS_LETTER_OR_DIGIT.test(cleaned[i]));
    const g2pText = fixArticle(shaddaFirst(present.map(i => cleaned[i]).join(' ')));
    const { phonemes, wordOf } = this.g2p.phonemizeWithWords(g2pText, { geminateFix: true, emphatics: 'dark' });
    let { ids, wordOfToken } = tokenize(phonemes, this.config.vocab, wordOf);
    if (ids.length > this.config.max_phonemes + 2) { // a single word over the limit: cut, as KPipeline does
      ids = [...ids.slice(0, this.config.max_phonemes + 1), 0];
      wordOfToken = [...wordOfToken.slice(0, this.config.max_phonemes + 1), -1];
    }
    return { phonemes, ids, wordOfToken: wordOfToken.map(word => (word >= 0 ? timed[word] ?? -1 : -1)) };
  }

  /** One model call; a take with NaN or Infinity is made again once, then it fails instead of playing silence. */
  private async run(session: ort.InferenceSession, prepared: PreparedSentence, pace: number): Promise<{ audio: Float32Array; durations: number[] }> {
    const { dim, rows } = this.config.voice;
    // KPipeline picks the style row by the phoneme string's length (characters outside the vocab included).
    const row = Math.max(0, Math.min([...prepared.phonemes].length, rows) - 1);
    for (let take = 1; take <= MAX_TAKES; take++) {
      const outputs = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(prepared.ids, id => BigInt(id)), [1, prepared.ids.length]),
        style: new ort.Tensor('float32', this.styles.slice(row * dim, (row + 1) * dim), [1, dim]),
        speed: new ort.Tensor('float32', Float32Array.of(pace), [1]),
      });
      // Copy out of the tensors so the buffer can be transferred to the main thread.
      const audio = Float32Array.from(outputs.waveform.data as Float32Array);
      const durations = Array.from(outputs.durations.data as BigInt64Array, frames => Number(frames));
      for (const tensor of Object.values(outputs)) tensor.dispose();
      if (audio.every(Number.isFinite)) return { audio, durations };
      this.context.onWarning(`The model returned an invalid take (${take} of ${MAX_TAKES}); ${take < MAX_TAKES ? 'making it again' : 'giving up'}.`);
    }
    throw new QariError('reading-failed', 'The model returned invalid audio twice for one sentence.');
  }

  /** Per word of the sentence: from the start of its first token to the end of its last (seconds, from the durations). */
  private wordSpans(sentence: number[], wordOfToken: number[], durations: number[]): { start: number; end: number }[] {
    const secondsPerFrame = this.config.samples_per_frame / this.config.sample_rate;
    const span = new Map<number, { start: number; end: number }>();
    let frame = 0;
    durations.forEach((frames, token) => {
      const word = wordOfToken[token];
      if (word >= 0) {
        const current = span.get(word);
        span.set(word, { start: Math.min(current?.start ?? Infinity, frame * secondsPerFrame), end: (frame + frames) * secondsPerFrame });
      }
      frame += frames;
    });
    // A word with no sound (punctuation, Latin): zero length where the previous word ended.
    let previousEnd = 0;
    return sentence.map((word) => {
      const found = span.get(word);
      if (!found) return { start: previousEnd, end: previousEnd };
      previousEnd = found.end;
      return found;
    });
  }

  /** Word timings when the voice asks for them; a mismatch is a developer warning and the audio plays without them. */
  private wordTimings(text: string, spokenWords: SpokenWord[], spans: { start: number; end: number }[], duration: number): WordTimings | undefined {
    if (this.voice.timings === 'none') return undefined;
    const timings = wordTimingsFromSpans({ text, spokenWords, spans, duration });
    if ('problem' in timings) {
      this.context.onWarning(`Word timings unavailable for this text: ${timings.problem}`);
      return undefined;
    }
    return timings;
  }
}
