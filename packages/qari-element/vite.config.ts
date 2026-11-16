// Library build for qari-element: ES modules only; qari-core stays external.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    rollupOptions: { external: [/^@khaledelansari\/qari-core$/, /^onnxruntime-web(\/.*)?$/] },
  },
});
