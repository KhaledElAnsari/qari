/**
 * The Worker that owns the models: accelerated-mode probe, download + OPFS cache, onnxruntime sessions, synthesis.
 * Requests are handled one at a time, in order. Every failure leaves as a QariError code plus a technical detail.
 */
import { probeBackend } from './backend/backend-probe';
import type { Backend, ProbeResult } from './backend/backend-probe';
import { describeError, QariError, toQariError } from './errors/qari-error';
import { fetchModel, openCacheDirectory } from './models/model-store';
import type { FileProgress } from './models/model-store';
import { MixerTtsAdapter } from './runtimes/mixer-tts.adapter';
import { configureOrt } from './runtimes/ort-session';
import type { AdapterContext, RuntimeAdapter, VoiceModels } from './runtimes/runtime-adapter';
import { modelKey } from './voice/voice-config';
import type { ModelFile, VoiceConfig } from './voice/voice-config';
import type { LoadProgress, WorkerRequest, WorkerResponse } from './worker/worker-protocol';

/** Short diacritized word synthesised once after loading, so the first real sentence starts fast. */
const WARM_UP_TEXT = 'سَلَامٌ';
const PROGRESS_INTERVAL_MS = 100;

const ADAPTERS: Readonly<Record<string, (context: AdapterContext) => RuntimeAdapter>> = {
  'mixer-tts': context => new MixerTtsAdapter(context),
};

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  navigator: Navigator;
}

const scope = globalThis as unknown as WorkerScope;
let adapter: RuntimeAdapter | null = null;
let loadedKey: string | null = null;
let loadedBackend: Backend = 'wasm';
let gpuProbe: ProbeResult | null = null;
let isOrtConfigured = false;
let queue: Promise<void> = Promise.resolve();

const post = (message: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

scope.addEventListener('message', (event) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      await handle(request);
    }
    catch (error) {
      const qariError = toQariError(error, 'unexpected');
      post({ type: 'error', requestId: request.requestId, code: qariError.code, detail: describeError(qariError) });
    }
  });
});

async function handle(request: WorkerRequest): Promise<void> {
  switch (request.type) {
    case 'probe':
      post({ type: 'probed', requestId: request.requestId, probe: await probeOnce() });
      return;
    case 'load':
      await load(request);
      return;
    case 'synthesize': {
      if (!adapter) throw new QariError('unexpected', 'Synthesize was requested before a voice was loaded.');
      const result = await runOn(loadedBackend, 'accelerated-mode-failed', 'reading-failed', () => (adapter as RuntimeAdapter).synthesize(request.text, request.pace, { normalize: request.normalize }));
      post({ type: 'audio', requestId: request.requestId, ...result }, [result.pcm.buffer]);
      return;
    }
    case 'dispose':
      await adapter?.dispose();
      adapter = null;
      loadedKey = null;
      post({ type: 'disposed', requestId: request.requestId });
  }
}

/** The GPU benchmark runs once per Worker; its answer doesn't change while the page is open. */
async function probeOnce(): Promise<ProbeResult> {
  gpuProbe ??= await probeBackend(scope.navigator.gpu);
  return gpuProbe;
}

/**
 * Runs a step on the chosen backend and names its failure for listeners. Nothing switches backend on its
 * own (decision 2026-11-16): a accelerated-mode failure is reported so the listener can retry or pick default mode.
 */
async function runOn<T>(backend: Backend, acceleratedCode: 'accelerated-mode-unavailable' | 'accelerated-mode-failed', defaultCode: 'voice-unavailable' | 'reading-failed', step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  }
  catch (error) {
    // Errors qari already named (e.g. nothing to read) keep their meaning whatever the backend.
    if (error instanceof QariError) throw error;
    throw new QariError(backend === 'webgpu' ? acceleratedCode : defaultCode, describeError(error));
  }
}

async function load(request: Extract<WorkerRequest, { type: 'load' }>): Promise<void> {
  const { requestId, voice, backend } = request;
  const context: AdapterContext = { onWarning: message => post({ type: 'warning', requestId, message }) };
  if (backend === 'webgpu') {
    const probe = await probeOnce();
    if (probe.backend !== 'webgpu') throw new QariError('accelerated-mode-unavailable', `Probe said ${probe.reason}${probe.gflops === undefined ? '' : ` (${probe.gflops.toFixed(2)} GFLOPS)`}.`);
  }

  const key = `${modelKey(voice)}|${backend}`;
  if (adapter && loadedKey === key) {
    adapter.useVoice(voice);
    post({ type: 'loaded', requestId, backend, reusedModels: true });
    return;
  }

  const createAdapter = ADAPTERS[voice.runtime];
  if (!createAdapter) throw new QariError('voice-unavailable', `No adapter for runtime "${voice.runtime}" (voice ${voice.id}).`);
  if (!isOrtConfigured) configureOrt({ wasmPaths: request.wasmPaths });
  isOrtConfigured = true;

  const models = await downloadModels(voice, requestId, context);
  await adapter?.dispose();
  adapter = null;
  loadedKey = null;

  postProgress(requestId, { stage: 'preparing', loadedBytes: 0, totalBytes: 0, fromCache: false });
  const nextAdapter = createAdapter(context);
  await runOn(backend, 'accelerated-mode-unavailable', 'voice-unavailable', () => nextAdapter.load(voice, models, backend));

  postProgress(requestId, { stage: 'warming', loadedBytes: 0, totalBytes: 0, fromCache: false });
  await runOn(backend, 'accelerated-mode-unavailable', 'voice-unavailable', () => nextAdapter.synthesize(WARM_UP_TEXT, voice.defaultPace ?? 1));

  adapter = nextAdapter;
  loadedKey = key;
  loadedBackend = backend;
  post({ type: 'loaded', requestId, backend, reusedModels: false });
}

/** Fetches every file of a voice, reporting combined byte progress. */
async function downloadModels(voice: VoiceConfig, requestId: number, context: AdapterContext): Promise<VoiceModels> {
  const directory = await openCacheDirectory();
  const files: ModelFile[] = voice.vocoder ? [voice.model, voice.vocoder] : [voice.model];
  const perFile: FileProgress[] = files.map(file => ({ loadedBytes: 0, totalBytes: file.sizeBytes ?? 0, fromCache: false }));
  let lastPostAt = 0;

  const report = (force: boolean) => {
    const now = performance.now();
    if (!force && now - lastPostAt < PROGRESS_INTERVAL_MS) return;
    lastPostAt = now;
    postProgress(requestId, {
      stage: 'downloading',
      loadedBytes: perFile.reduce((sum, file) => sum + file.loadedBytes, 0),
      totalBytes: perFile.reduce((sum, file) => sum + file.totalBytes, 0),
      fromCache: perFile.every(file => file.fromCache),
    });
  };

  const bytes: Uint8Array[] = [];
  for (const [i, file] of files.entries()) {
    bytes.push(await fetchModel(file, {
      directory,
      onWarning: context.onWarning,
      onProgress: (progress) => {
        perFile[i] = progress;
        report(false);
      },
    }));
  }
  report(true);
  return { model: bytes[0], vocoder: bytes[1] };
}

function postProgress(requestId: number, progress: LoadProgress): void {
  post({ type: 'progress', requestId, progress });
}
