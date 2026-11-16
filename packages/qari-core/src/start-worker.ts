/**
 * Starts qari's synth Worker. The URL is a literal next to this file on purpose: in the published package it points
 * at dist/synth.worker.js, and host bundlers (Vite, webpack 5) recognise `new Worker(new URL(..., import.meta.url))`
 * and bundle the Worker with its onnxruntime import. In this repo's demo, Vite maps the .js to synth.worker.ts.
 */
export function startSynthWorker(): Worker {
  return new Worker(new URL('./synth.worker.js', import.meta.url), { type: 'module', name: 'qari-synth' });
}
