import * as ort from 'onnxruntime-web/webgpu';
import { peakNormalize } from '../audio/peak-normalize';
import { prepareArabicText } from '../frontends/arabic-phonetiser/prepare-text';
import { arabicToTokens, tokensToIds } from '../frontends/arabic-phonetiser/tokenize';
import type { Backend } from '../backend/backend-probe';
import { QariError } from '../errors/qari-error';
import { isSpokenToken } from '../frontends/arabic-phonetiser/symbols';
import type { VoiceConfig } from '../voice/voice-config';
import type { AdapterContext, RuntimeAdapter, SynthesisResult, VoiceModels } from './runtime-adapter';
import { createSession } from './ort-session';

const MEL_OUTPUT = 'mel_spec';
const DEFAULT_DENOISE = 0.005;

/**
 * nipponjo Mixer-TTS / FastPitch acoustic model + Vocos vocoder (two ONNX files).
 * Inputs and defaults follow nipponjo/tts_arabic `models/tts_models.py`.
 */
export class MixerTtsAdapter implements RuntimeAdapter {
  private acoustic: ort.InferenceSession | null = null;
  private vocoder: ort.InferenceSession | null = null;
  private voice: VoiceConfig;
  private hasWarnedAboutDurations = false;

  constructor(private readonly context: AdapterContext) {}

  async load(voice: VoiceConfig, models: VoiceModels, backend: Backend): Promise<void> {
    if (!models.vocoder) throw new QariError('voice-unavailable', `Voice ${voice.id} uses runtime mixer-tts, which needs a vocoder file.`);
    this.voice = voice;
    // Sequential on purpose: two parallel WebGPU session builds compete for shader compilation.
    this.acoustic = await createSession(models.model, backend);
    this.vocoder = await createSession(models.vocoder, backend);
  }

  useVoice(voice: VoiceConfig): void {
    this.voice = voice;
    this.hasWarnedAboutDurations = false;
  }

  async synthesize(sentence: string, pace: number): Promise<SynthesisResult> {
    if (!this.acoustic || !this.vocoder) throw new Error('Voice is not loaded yet.');
    const tokens = arabicToTokens(prepareArabicText(sentence));
    // Digits and Latin letters make no sound until normalization (Q3); text made only of them has nothing to say.
    if (!tokens.some(isSpokenToken)) throw new QariError('nothing-to-read', 'The text has no Arabic letters the voice can say.');
    const { ids, unknownTokens } = tokensToIds(tokens);
    if (unknownTokens.length > 0) this.context.onWarning(`Skipped tokens the voice doesn't know: ${unknownTokens.join(' ')}.`);

    const feeds = pickFeeds(this.acoustic.inputNames, {
      token_ids: new ort.Tensor('int64', BigInt64Array.from(ids, id => BigInt(id)), [1, ids.length]),
      pace: new ort.Tensor('float32', Float32Array.of(pace), [1]),
      speaker: new ort.Tensor('int32', Int32Array.of(this.voice.speaker ?? 0), [1]),
      pitch_mul: new ort.Tensor('float32', Float32Array.of(1), [1]),
      pitch_add: new ort.Tensor('float32', Float32Array.of(0), [1]),
    });
    const acousticOutputs = await this.acoustic.run(feeds);
    const mel = acousticOutputs[MEL_OUTPUT] ?? acousticOutputs[this.acoustic.outputNames[0]];
    const durations = this.readDurations(acousticOutputs);

    const vocoderOutputs = await this.vocoder.run(pickFeeds(this.vocoder.inputNames, {
      mel_spec: mel,
      denoise: new ort.Tensor('float32', Float32Array.of(DEFAULT_DENOISE), [1]),
    }));
    const wave = vocoderOutputs[this.vocoder.outputNames[0]];
    // Copy out of the tensor so the buffer can be transferred to the main thread.
    const pcm = peakNormalize(Float32Array.from(wave.data as Float32Array));
    for (const tensor of [...Object.values(acousticOutputs), ...Object.values(vocoderOutputs)]) tensor.dispose();
    return { pcm, sampleRate: this.voice.sampleRate, durations };
  }

  async dispose(): Promise<void> {
    await Promise.all([this.acoustic?.release(), this.vocoder?.release()]);
    this.acoustic = null;
    this.vocoder = null;
  }

  /** Reads the per-token durations output when the voice asks for native timings and the model has it. */
  private readDurations(outputs: ort.InferenceSession.OnnxValueMapType): number[] | undefined {
    const name = this.voice.durationOutput;
    if (this.voice.timings !== 'native' || !name) return undefined;
    const tensor = outputs[name];
    if (!tensor) {
      // Q1 accepts the unpatched model; Q4 turns this into a load error (docs/decisions.md).
      if (!this.hasWarnedAboutDurations) this.context.onWarning(`Model for ${this.voice.id} has no "${name}" output yet, so word timings are unavailable.`);
      this.hasWarnedAboutDurations = true;
      return undefined;
    }
    return Array.from(tensor.data as BigInt64Array, frames => Number(frames));
  }
}

/** Keeps only the feeds the model declares, so variants with fewer inputs (e.g. no pitch controls) still run. */
function pickFeeds(inputNames: readonly string[], candidates: Record<string, ort.Tensor>): Record<string, ort.Tensor> {
  return Object.fromEntries(inputNames.filter(name => name in candidates).map(name => [name, candidates[name]]));
}
