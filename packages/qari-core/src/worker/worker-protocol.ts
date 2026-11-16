import type { Backend, ProbeResult } from '../backend/backend-probe';
import type { QariErrorCode } from '../errors/qari-error';
import type { VoiceConfig } from '../voice/voice-config';

/** Load stages shown by the "Prepare voice" step (PRD Q1). */
export type LoadStage = 'downloading' | 'preparing' | 'warming';

/** Download progress across all files of a voice. */
export interface LoadProgress {
  stage: LoadStage;
  loadedBytes: number;
  totalBytes: number;
  fromCache: boolean;
}

// ------------------------------------------------ main thread → worker

export type WorkerRequest =
  | { type: 'probe'; requestId: number }
  | { type: 'load'; requestId: number; voice: VoiceConfig; backend: Backend; wasmPaths?: string }
  | { type: 'synthesize'; requestId: number; text: string; pace: number }
  | { type: 'dispose'; requestId: number };

// ------------------------------------------------ worker → main thread

export type WorkerResponse =
  | { type: 'probed'; requestId: number; probe: ProbeResult }
  | { type: 'progress'; requestId: number; progress: LoadProgress }
  | { type: 'loaded'; requestId: number; backend: Backend; reusedModels: boolean }
  | { type: 'audio'; requestId: number; pcm: Float32Array; sampleRate: number; durations?: number[] }
  | { type: 'disposed'; requestId: number }
  | { type: 'warning'; requestId: number; message: string }
  | { type: 'error'; requestId: number; code: QariErrorCode; detail: string };
