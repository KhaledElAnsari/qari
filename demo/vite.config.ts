// Demo page (not published). `npm run dev` serves it; set QARI_ISOLATE=1 to add COOP/COEP and get multithreaded WASM.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromRoot = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const isolationHeaders = process.env.QARI_ISOLATE === '1'
  ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }
  : undefined;

export default defineConfig({
  root: fromRoot('demo'),
  base: './',
  // The example voice configs are served at the site root (male-sound.json, female-sound.json).
  publicDir: fromRoot('voices'),
  resolve: {
    alias: {
      '@khaledelansari/qari-core': fromRoot('packages/qari-core/src/index.ts'),
      '@khaledelansari/qari-element': fromRoot('packages/qari-element/src/index.ts'),
    },
  },
  // Pre-bundling breaks onnxruntime-web's lookup of its .wasm files next to its own module.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
  build: { outDir: fromRoot('demo/dist'), emptyOutDir: true, target: 'es2022' },
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
});
