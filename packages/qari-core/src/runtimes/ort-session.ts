import * as ort from 'onnxruntime-web/webgpu';
import type { Backend } from '../backend/backend-probe';

const MAX_WASM_THREADS = 4;

/** Global onnxruntime settings; call once in the Worker before the first session. */
export function configureOrt(options: { wasmPaths?: string }): void {
  // Multithreaded WASM needs cross-origin isolation (COOP same-origin + COEP credentialless/require-corp).
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(MAX_WASM_THREADS, navigator.hardwareConcurrency || 1) : 1;
  if (options.wasmPaths) ort.env.wasm.wasmPaths = options.wasmPaths;
}

/** Creates a session on the chosen backend only; the caller turns a failure into a listener-facing error. */
export async function createSession(bytes: Uint8Array, backend: Backend): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(bytes, { executionProviders: [backend] });
}
