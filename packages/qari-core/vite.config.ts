// Library build for qari-core: two ES entries (index.js, synth.worker.js), onnxruntime-web left external.
// Vite's worker/asset URL plugins are switched off for this build only, so dist keeps the literal
// `new URL('./synth.worker.js', import.meta.url)` that host bundlers need to find the Worker (see src/start-worker.ts).
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const URL_REWRITING_PLUGINS = new Set(['vite:worker-import-meta-url', 'vite:asset-import-meta-url']);

const keepWorkerUrlLiteral: Plugin = {
  name: 'qari:keep-worker-url-literal',
  configResolved(config) {
    const plugins = config.plugins as Plugin[];
    for (let i = plugins.length - 1; i >= 0; i--) {
      if (URL_REWRITING_PLUGINS.has(plugins[i].name)) plugins.splice(i, 1);
    }
  },
};

export default defineConfig({
  plugins: [keepWorkerUrlLiteral],
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: { 'index': 'src/index.ts', 'synth.worker': 'src/synth.worker.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: { external: [/^onnxruntime-web(\/.*)?$/] },
  },
});
