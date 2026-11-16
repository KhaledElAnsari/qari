import type { Backend } from '../backend/backend-probe';
import type { VoiceConfig } from '../voice/voice-config';

/** Model bytes for a voice, already downloaded or read from the cache. */
export interface VoiceModels {
  model: Uint8Array;
  vocoder?: Uint8Array;
}

/** Audio for one sentence; `durations` are per-token frame counts when the model exposes them. */
export interface SynthesisResult {
  pcm: Float32Array;
  sampleRate: number;
  durations?: number[];
}

/** Runs one model family; picked by VoiceConfig.runtime so new families plug in without touching the UI (PRD 5.3). */
export interface RuntimeAdapter {
  load(voice: VoiceConfig, models: VoiceModels, backend: Backend): Promise<void>;
  /** Switches to a voice that uses the same model files (e.g. another speaker). */
  useVoice(voice: VoiceConfig): void;
  /** `pace` is a speed multiplier: 1 is normal, above 1 is faster. */
  synthesize(sentence: string, pace: number): Promise<SynthesisResult>;
  dispose(): Promise<void>;
}

/** Context every adapter gets: where to send non-fatal problems. */
export interface AdapterContext {
  onWarning: (message: string) => void;
}
