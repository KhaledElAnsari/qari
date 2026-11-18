# قارئ (Qari)

An embeddable reader for the web: paste Arabic text and قارئ reads it aloud **on the device**, highlighting each word as it is spoken. A headless engine (`qari-core`) plus a drop-in Web Component (`<qari-reader>`).

Status: **beta in progress** — milestones Q0 (repo, tooling, CI) and Q1 (load a voice from a URL, probe the backend, synthesize in a Worker) are done. See [docs/decisions.md](docs/decisions.md) for every choice and assumption, and the PRD (`prd/qari-mini-prd.md` in the مقروء project) for the plan.

## Layout

```
packages/qari-core      headless engine: voice config, default/accelerated mode, friendly errors, OPFS model cache, Worker + onnxruntime-web, playback
packages/qari-element   <qari-reader> Web Component (Q0 stub; real element in Q5)
demo/                   static demo page (Vite), imports the packages from source
voices/                 example voice configs; voices/models/ holds the model files you download (git-ignored)
tests/e2e/              Playwright browser tests; tests/fixtures holds two tiny stand-in ONNX models
tools/                  fetch-models.ts (voice files for builds) and test-fixture generators (Python)
deploy/                 server configs: apache/.htaccess (Hostinger, LiteSpeed), caddy/Caddyfile, nginx/
docs/                   decisions and assumptions
```

## Run it locally

Tested on a fresh copy on 2026-11-16 (install about 10 s, then 147 tests pass and the dev server starts).

1. Use Node 24.11 or newer (`nvm use` reads `.nvmrc`).
2. Unpack the repo and open the folder.
3. Run `git init` first: `npm install` wires the git hooks, and that needs a git folder.
4. Run `npm install`.
5. Put the voice files in `voices/models/nipponjo/`: `mixer128_dur.onnx` (built from `mixer128.onnx` by `scripts/patch-durations.py`) and `vocos22.onnx` (how: [voices/models/README.md](voices/models/README.md)).
6. Run `npm run dev` and open http://localhost:5173 in Chrome, then press **Prepare audio** and **Read**.
7. Optional:
   - `QARI_ISOLATE=1 npm run dev` for multithreaded default mode.
   - `npm run check` for lint, types, tests and build.
   - `npx playwright install chromium` once, then `npm run test:browser`.

On an Android phone: connect it by USB with debugging on, run `adb reverse tcp:5173 tcp:5173`, and open `localhost:5173` on the phone. A `192.168.x.x` address counts as insecure, so the voice cache and accelerated mode would be off.

## Package plan

Core, web, Node and element packages, plus framework wrappers later: [docs/package-plan.md](docs/package-plan.md).

## Using qari-core (Q1 API)

```ts
import { createReader, loadVoiceConfig, probeDevice } from '@khaledelansari/qari-core';

const voice = await loadVoiceConfig('/voices/male-sound.json');
const reader = await createReader({ voice }); // default mode; download/cache → prepare → warm up
reader.on('progress', ({ stage, loadedBytes, totalBytes }) => {});
reader.on('error', error => showMessage(error.text.ar)); // plain words for listeners; error.detail is for logs
reader.on('warning', message => console.warn(message));

button.onclick = () => reader.speak('اَلسَّلامُ عَلَيكُم'); // call from a click so Safari allows audio
await reader.setVoice(await loadVoiceConfig('/voices/female-sound.json')); // same files: no download

const { backend } = await probeDevice();              // 'webgpu' when accelerated mode can run here
if (backend === 'webgpu') await reader.setBackend('webgpu'); // only when the listener picks accelerated mode
```

Errors are `QariError`s: show `error.text.ar` / `error.text.en`, use `canRetry` and `suggestsDefaultMode` to pick the buttons, and keep `error.detail` for logs. qari never switches mode by itself.

Host requirements: HTTPS (OPFS and WebGPU need a secure context). Without COOP/COEP headers onnxruntime runs single-threaded; with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` it uses up to 4 threads. Model hosts must send CORS headers.

Vite hosts: add `optimizeDeps: { exclude: ['onnxruntime-web'] }` and `worker: { format: 'es' }`. The engine starts its Worker with `new Worker(new URL('./synth.worker.js', import.meta.url))`, which Vite and webpack 5 bundle automatically.

## Deploying

The demo is static files on any HTTPS host. `.github/workflows/deploy.yml` builds once and deploys to Hostinger (or any server with SSH) and/or GitHub Pages, each switched on by a repository variable. Server configs for Apache/LiteSpeed, Caddy and Nginx are in `deploy/`. Full guide: [docs/deployment.md](docs/deployment.md).

## Voices

`voices/male-sound.json` (default, nipponjo speaker 1) and `voices/female-sound.json` (speaker 3) use the same two model files, Mixer-TTS-128 + Vocos 22k, from `voices/models/nipponjo/` (download them first: [voices/models/README.md](voices/models/README.md)). `voices/bayan.json` is **Bayan (Murad)**, a larger, more natural voice (NVIDIA Open Model License; seven files, 705 MB in `voices/models/bayan/`). It is meant for accelerated mode (about real time on an M4 Pro; default mode works but is ~2.5× slower than real time) and has word timings from its attention (±0.1–0.2 s) but no speed control: [docs/decisions.md](docs/decisions.md#bayan-voice-magpie-tts-runtime-started-2026-11-17). `voices/nabra.json` is **Nabra** («نبرة»), a natural female voice (Apache-2.0; four files, 158 MB in `voices/models/nabra/`, including espeak-ng, which is GPL-3.0). It is fast in both modes (about 15× faster than real time in accelerated mode on an M4 Pro, ~2.5× in default mode with 4 threads), reads at speed 0.9 by default, and has word timings from its own durations (±75 ms): [docs/decisions.md](docs/decisions.md#nabra-voice-kokoro-runtime-started-2026-11-18). Normalization always runs (from Q3). قارئ has no tashkeel step in the beta: the voices read the text as pasted, so paste **diacritized** Arabic for the best pronunciation.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Demo at http://localhost:5173 (`QARI_ISOLATE=1 npm run dev` adds COOP/COEP) |
| `npm run lint` · `npm run typecheck` · `npm test` | ESLint, TypeScript, Jest (pure logic) |
| `npm run build` | Both packages (`dist/`) and the demo (`demo/dist/`) |
| `npm run test:browser` | Playwright on Chromium (`QARI_CHROME_PATH=…` to use an installed Chrome) |
| `npm run check` | Lint, typecheck, tests and build |
| `npm run fetch-models` | Downloads missing voice files into `voices/models/` from `QARI_MODELS_BASE_URL` (used by deploys) |

Git hooks live in `.githooks/` (set up by `npm install`): pre-commit runs `eslint --fix` on staged files, pre-push runs typecheck and tests.

Regenerate fixtures: `python3 -I tools/gen-phonetiser-golden.py <tts_arabic/tts_arabic> > packages/qari-core/src/frontends/arabic-phonetiser/fixtures/phonetiser-golden.json` and `python3 -I tools/make-test-models.py tests/fixtures`.

## Licence

Code: Apache-2.0 (the `LICENSE` and `NOTICE` files land once the public repo exists). Free to use, including commercially; keep the NOTICE file when you redistribute qari. Third-party parts: [THIRD_PARTY.md](THIRD_PARTY.md).

The example voices are a separate matter: the nipponjo Mixer-TTS and Vocos models are licensed **non-commercial**, whatever qari's own licence. Use voices whose licence fits your project.

### Credit

If you use qari, please mention it. `<qari-reader>` shows a small "Powered by Qari · قارئ" credit by default (`credit="off"` hides it); if you use `qari-core` directly, add `<qari-credit>` from `qari-element` wherever it fits.
