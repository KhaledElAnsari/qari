import { peakNormalize } from '../../audio/peak-normalize';
import type { Backend } from '../../backend/backend-probe';
import { QariError } from '../../errors/qari-error';
import { normalizeForSpeech } from '../../normalization/normalize';
import type { SpokenWord } from '../../normalization/normalize';
import { splitDisplayWords, wordTimingsFromSpans } from '../../timings/word-timings';
import type { WordTimings } from '../../timings/word-timings';
import type { VoiceConfig } from '../../voice/voice-config';
import type { AdapterContext, RuntimeAdapter, SynthesisOptions, SynthesisResult, VoiceModels } from '../runtime-adapter';
import { attentionWordSpans } from './attention-timings';
import { parseBayanConfig } from './bayan-config';
import type { BayanConfig } from './bayan-config';
import { MagpieGenerator } from './generator';
import type { Take } from './generator';
import { groupSentences } from './sentences';
import { BayanTokenizer } from './tokenizer';

/** Files a magpie-tts voice lists under `files`, besides `model` (decoder step) and `vocoder` (codec). */
export const MAGPIE_FILES = ['config', 'textEncoder', 'ltSample', 'voiceContext', 'bosEmbedding'] as const;

/** Takes per sentence: the first finished one is used (sampling ends ~1 take in 5 early, as in NeMo's own do_tts). */
export const MAX_TAKES = 3;
/** Silence between sentences. */
const SENTENCE_GAP_SECONDS = 0.2;
/** Longest piece read in one take, in letters (diacritics don't count); Bayan's max is ~37 s of audio. */
const MAX_SENTENCE_LETTERS = 180;

/** Per spoken word: does a line break follow it in the text (a sentence ends there)? */
function lineBreaksAfter(text: string, spokenWords: readonly SpokenWord[]): boolean[] {
  const display = splitDisplayWords(text);
  return spokenWords.map((word, i) => {
    const lastOfItsWord = i + 1 === spokenWords.length || spokenWords[i + 1].displayIndex !== word.displayIndex;
    const next = display[word.displayIndex + 1];
    return lastOfItsWord && next !== undefined && text.slice(display[word.displayIndex].charEnd, next.charStart).includes('\n');
  });
}

/** Copies bytes into an aligned Float32Array (the downloaded Uint8Array may start at any offset). */
const toFloat32 = (bytes: Uint8Array) => new Float32Array(bytes.slice().buffer);

/**
 * Bayan-Arabic-TTS (NeMo MagpieTTS, decoder_ce, baked voice «مراد») exported by bayan-onnx/export/export_bayan_onnx.py.
 * Reads one sentence per take and retries a take that ends early; if every take of a sentence ends early, reading
 * fails with 'reading-failed' (press play to try again): the cause is sampling, not the device, so default mode
 * wouldn't help. Word timings come from the decoder's attention (timings: "alignment", ±0.1–0.2 s). No speed control.
 */
export class MagpieTtsAdapter implements RuntimeAdapter {
  private generator: MagpieGenerator | null = null;
  private config: BayanConfig;
  private tokenizer: BayanTokenizer;
  private voice: VoiceConfig;
  private warnedPace = false;

  constructor(private readonly context: AdapterContext) {}

  async load(voice: VoiceConfig, models: VoiceModels, backend: Backend): Promise<void> {
    const files = models.files ?? {};
    const missing: string[] = MAGPIE_FILES.filter(name => !files[name]);
    if (!models.vocoder) missing.push('vocoder (codec)');
    if (missing.length > 0) throw new QariError('voice-unavailable', `Voice ${voice.id} (runtime magpie-tts) is missing: ${missing.join(', ')}.`);
    try {
      this.config = parseBayanConfig(files.config);
    }
    catch (error) {
      throw new QariError('voice-unavailable', `Voice ${voice.id}: ${error instanceof Error ? error.message : String(error)}.`);
    }
    if (this.config.sample_rate !== voice.sampleRate) {
      throw new QariError('voice-unavailable', `Voice ${voice.id} says ${voice.sampleRate} Hz but its model makes ${this.config.sample_rate} Hz.`);
    }
    this.voice = voice;
    this.tokenizer = new BayanTokenizer(this.config.tokenizer);
    this.generator = new MagpieGenerator(this.config, toFloat32(files.voiceContext), toFloat32(files.bosEmbedding));
    await this.generator.load({
      textEncoder: files.textEncoder,
      decoderStep: models.model,
      ltSample: files.ltSample,
      codecDecoder: models.vocoder as Uint8Array,
    }, backend);
  }

  useVoice(voice: VoiceConfig): void {
    this.voice = voice;
  }

  async synthesize(text: string, pace: number, options: SynthesisOptions = {}): Promise<SynthesisResult> {
    const generator = this.generator;
    if (!generator) throw new Error('Voice is not loaded yet.');
    if (pace !== 1 && !this.warnedPace) {
      this.context.onWarning('This voice has no speed control; it reads at its normal speed.');
      this.warnedPace = true;
    }
    const spokenWords = normalizeForSpeech(text, { enabled: options.normalize ?? true });
    const words = spokenWords.map(word => word.text);
    const sentences = groupSentences(words, MAX_SENTENCE_LETTERS, lineBreaksAfter(text, spokenWords));
    const sentenceText = (sentence: number[]) => sentence.map(i => words[i]).join(' ');
    if (!sentences.some(sentence => this.tokenizer.hasSpeech(sentenceText(sentence)))) {
      throw new QariError('nothing-to-read', 'The text has no Arabic letters the voice can say.');
    }

    const sampleRate = this.config.sample_rate;
    const gap = Math.round(SENTENCE_GAP_SECONDS * sampleRate);
    const parts: Float32Array[] = [];
    const spans: { start: number; end: number }[] = new Array(words.length);
    let samples = 0;
    for (const sentence of sentences) {
      const offset = samples / sampleRate;
      if (!this.tokenizer.hasSpeech(sentenceText(sentence))) {
        for (const i of sentence) spans[i] = { start: offset, end: offset }; // nothing to say: zero-length where the reading is
        continue;
      }
      if (parts.length > 0) samples += gap;
      const { ids, tokenWords, wordCount } = this.tokenizer.encodeWithWords(sentenceText(sentence));
      const take = await this.finishedTake(generator, ids, sentenceText(sentence));
      const audio = await generator.decode(take);
      const local = attentionWordSpans({
        attSteps: take.attSteps, tokenWords, wordCount, frames: take.frames, audio,
        frameStacking: this.config.frame_stacking, samplesPerFrame: this.config.samples_per_frame, sampleRate,
      });
      const start = samples / sampleRate;
      sentence.forEach((wordIndex, k) => {
        const span = local[k] ?? { start: 0, end: 0 };
        spans[wordIndex] = { start: start + span.start, end: start + span.end };
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
    await this.generator?.dispose();
    this.generator = null;
  }

  /** Word timings when the voice asks for them; a mismatch is a developer warning and the audio plays without them. */
  private wordTimings(text: string, spokenWords: SpokenWord[], spans: { start: number; end: number }[], duration: number): WordTimings | undefined {
    if (this.voice.timings !== 'alignment') return undefined;
    const timings = wordTimingsFromSpans({ text, spokenWords, spans, duration });
    if ('problem' in timings) {
      this.context.onWarning(`Word timings unavailable for this text: ${timings.problem}`);
      return undefined;
    }
    return timings;
  }

  /** Up to MAX_TAKES takes with fresh seeds; the first that reaches the end of the sentence is used. */
  private async finishedTake(generator: MagpieGenerator, ids: number[], sentence: string): Promise<Take> {
    let take: Take | null = null;
    for (let attempt = 1; attempt <= MAX_TAKES; attempt++) {
      take = await generator.generate(ids, { seed: (Math.random() * 2 ** 31) | 0 });
      if (take.finished) {
        if (attempt > 1) this.context.onWarning(`Sentence needed ${attempt} takes (earlier takes ended early).`);
        return take;
      }
    }
    // Named here, so the Worker doesn't report it as an accelerated-mode failure: the device worked, sampling didn't finish.
    throw new QariError('reading-failed', `No finished take in ${MAX_TAKES} attempts for "${sentence.slice(0, 40)}…" `
      + `(last: end frame ${take?.eosFrame}, attention ${take?.lastAtt}/${take?.textLength}).`);
  }
}
