import type { Backend, ProbeResult } from '../backend/backend-probe';
import { parseErrorCode, QariError, toQariError } from '../errors/qari-error';
import { PcmPlayer } from '../playback/pcm-player';
import { startSynthWorker } from '../start-worker';
import type { VoiceConfig } from '../voice/voice-config';
import type { LoadProgress, WorkerRequest, WorkerResponse } from '../worker/worker-protocol';
import { TypedEvents } from './typed-events';

export type ReaderState = 'loading' | 'warming' | 'ready' | 'playing' | 'paused';

/** Events a reader emits (word events arrive with Q4). */
export interface ReaderEvents {
  state: ReaderState;
  progress: LoadProgress;
  /** Technical notes for developers (console, logs); never shown to listeners. */
  warning: string;
  /** Show `error.text.ar` / `error.text.en` to listeners; `error.detail` is for developers only. */
  error: QariError;
}

/** Options for createReader (PRD section 6). */
export interface ReaderOptions {
  voice: VoiceConfig;
  /** 'wasm' (default mode) by default; 'webgpu' (accelerated mode) only when the listener chooses it. */
  backend?: Backend;
  /** Where onnxruntime-web's .wasm files are served from, when the host bundles them itself. */
  wasmPaths?: string;
  /** A Worker running qari's synth worker; by default qari starts its own. */
  worker?: Worker;
}

/** Audio for a piece of text, without playing it. */
export interface Synthesis {
  pcm: Float32Array<ArrayBuffer>;
  sampleRate: number;
  durations?: number[];
}

export interface Reader {
  readonly voice: VoiceConfig;
  readonly backend: Backend;
  readonly state: ReaderState;
  on<Name extends keyof ReaderEvents>(name: Name, listener: (payload: ReaderEvents[Name]) => void): () => void;
  off<Name extends keyof ReaderEvents>(name: Name, listener: (payload: ReaderEvents[Name]) => void): void;
  /**
   * Synthesizes and plays; Q1 treats the whole text as one sentence (splitting and streaming arrive in Q2).
   * Rejects with a QariError (also emitted as `error`); calling speak again is the retry.
   */
  speak(text: string, options?: { pace?: number }): Promise<void>;
  stop(): void;
  synthesize(text: string, options?: { pace?: number }): Promise<Synthesis>;
  /** Switches voice; same model files (e.g. Male → Female sound) reuse the loaded sessions. On failure, the previous voice is reloaded, then it rejects. */
  setVoice(voice: VoiceConfig): Promise<void>;
  /** Switches between default and accelerated mode. If accelerated mode fails, the reader goes back to the previous mode, then rejects. */
  setBackend(backend: Backend): Promise<void>;
  dispose(): Promise<void>;
}

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: LoadProgress) => void;
}

/** Talks to the synth Worker with request ids. */
class WorkerClient {
  private nextRequestId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(readonly worker: Worker, private readonly onWarning: (message: string) => void) {
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.receive(event.data));
    worker.addEventListener('error', (event) => {
      const error = new QariError('unexpected', `qari worker failed: ${event.message || 'unknown error'}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  request<Type extends WorkerResponse['type']>(message: DistributiveOmit<WorkerRequest, 'requestId'>, expected: Type, onProgress?: (progress: LoadProgress) => void): Promise<Extract<WorkerResponse, { type: Type }>> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (response) => {
          if (response.type === expected) resolve(response as Extract<WorkerResponse, { type: Type }>);
          else reject(new QariError('unexpected', `Unexpected worker response ${response.type}.`));
        },
        reject,
        onProgress,
      });
      this.worker.postMessage({ ...message, requestId } as WorkerRequest);
    });
  }

  private receive(response: WorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (response.type === 'warning') {
      this.onWarning(response.message);
      return;
    }
    if (response.type === 'progress') {
      pending?.onProgress?.(response.progress);
      return;
    }
    if (!pending) return;
    this.pending.delete(response.requestId);
    if (response.type === 'error') pending.reject(new QariError(parseErrorCode(response.code), response.detail));
    else pending.resolve(response);
  }
}

type DistributiveOmit<T, Key extends PropertyKey> = T extends unknown ? Omit<T, Key> : never;

/** Says whether accelerated mode (WebGPU) can run on this device, without loading a voice; hosts use it to show or hide the choice. */
export async function probeDevice(options: { worker?: Worker } = {}): Promise<ProbeResult> {
  const worker = options.worker ?? startSynthWorker();
  const client = new WorkerClient(worker, () => undefined);
  try {
    return (await client.request({ type: 'probe' }, 'probed')).probe;
  }
  finally {
    if (!options.worker) worker.terminate();
  }
}

/** Loads a voice in a Worker (probe → download/cache → prepare → warm up) and returns a reader for it. */
export async function createReader(options: ReaderOptions): Promise<Reader> {
  assertBrowserSupport();
  const events = new TypedEvents<ReaderEvents>();
  const worker = options.worker ?? startSynthWorker();
  const client = new WorkerClient(worker, message => events.emit('warning', message));
  const player = new PcmPlayer();
  let voice = options.voice;
  let backend: Backend = options.backend ?? 'wasm';
  let state: ReaderState = 'loading';
  let speakRun = 0;

  const setState = (next: ReaderState) => {
    if (next === state) return;
    state = next;
    events.emit('state', next);
  };

  const loadVoice = async (next: VoiceConfig, nextBackend: Backend) => {
    setState('loading');
    const loaded = await client.request({ type: 'load', voice: next, backend: nextBackend, wasmPaths: options.wasmPaths }, 'loaded', (progress) => {
      if (progress.stage === 'warming') setState('warming');
      events.emit('progress', progress);
    });
    voice = next;
    backend = loaded.backend;
    setState('ready');
  };

  /** Emits a failure as a QariError and returns it, so callers can rethrow the same object. */
  const fail = (error: unknown, fallback: 'unexpected' | 'reading-failed' = 'unexpected') => {
    const qariError = toQariError(error, fallback);
    events.emit('error', qariError);
    return qariError;
  };

  const synthesize = async (text: string, synthesisOptions: { pace?: number } = {}): Promise<Synthesis> => {
    const audio = await client.request({ type: 'synthesize', text, pace: synthesisOptions.pace ?? voice.defaultPace ?? 1 }, 'audio');
    return { pcm: audio.pcm as Float32Array<ArrayBuffer>, sampleRate: audio.sampleRate, durations: audio.durations };
  };

  const reader: Reader = {
    get voice() {
      return voice;
    },
    get backend() {
      return backend;
    },
    get state() {
      return state;
    },
    on: (name, listener) => events.on(name, listener),
    off: (name, listener) => events.off(name, listener),
    async speak(text, speakOptions) {
      // Must run before any await so the browser still sees the user's gesture.
      player.unlock();
      const run = ++speakRun;
      player.stop();
      try {
        if (text.trim() === '') throw new QariError('nothing-to-read', 'Empty text.');
        const audio = await synthesize(text, speakOptions);
        if (run !== speakRun) return;
        setState('playing');
        await player.play(audio.pcm, audio.sampleRate);
      }
      catch (error) {
        throw fail(error, 'reading-failed');
      }
      finally {
        if (run === speakRun && state === 'playing') setState('ready');
      }
    },
    stop() {
      speakRun++;
      player.stop();
      if (state === 'playing' || state === 'paused') setState('ready');
    },
    synthesize,
    async setVoice(next) {
      reader.stop();
      const previous = voice;
      try {
        await loadVoice(next, backend);
      }
      catch (error) {
        const qariError = fail(error);
        // Keep the voice the listener had working; a retry is just calling setVoice again.
        if (next !== previous) await loadVoice(previous, backend).catch(() => undefined);
        throw qariError;
      }
    },
    async setBackend(next) {
      if (next === backend && state !== 'loading') return;
      reader.stop();
      const previous = backend;
      try {
        await loadVoice(voice, next);
      }
      catch (error) {
        const qariError = fail(error);
        // Leave the listener with a working reader in the mode they had; models come from the cache, so this is quick.
        if (next !== previous) await loadVoice(voice, previous).catch(() => undefined);
        throw qariError;
      }
    },
    async dispose() {
      reader.stop();
      await client.request({ type: 'dispose' }, 'disposed').catch(() => undefined);
      if (!options.worker) worker.terminate();
      await player.close();
      events.clear();
    },
  };

  try {
    await loadVoice(voice, backend);
  }
  catch (error) {
    if (!options.worker) worker.terminate();
    throw toQariError(error, 'unexpected');
  }
  return reader;
}

/** Throws 'browser-unsupported' when the browser lacks what every voice needs. */
function assertBrowserSupport(): void {
  const missing = [
    typeof Worker === 'undefined' && 'Worker',
    typeof WebAssembly === 'undefined' && 'WebAssembly',
    typeof AudioContext === 'undefined' && 'AudioContext',
  ].filter(Boolean);
  if (missing.length > 0) throw new QariError('browser-unsupported', `Missing ${missing.join(', ')}.`);
}
