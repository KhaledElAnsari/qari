# Decisions and assumptions

Every choice made while building قارئ that the PRD (`prd/qari-mini-prd.md` in the مقروء project) does not fix, with the reason. Change a line here in the same commit as the code it describes.

Confidence tags: **[Certain]** checked or measured; **[Likely]** strong inference; **[Guessing]** filled a gap, needs confirming.

## Aligning with PRD v0.2 (2026-11-16)

Q0 and Q1 were first built against the earlier PRD (Arabic + English, optional tashkeel, milestones up to Q7). Changes for v0.2:

- [Certain] **Arabic only.** Removed `language` from `VoiceConfig` (5.3 has none) and the element's `lang` attribute; `<qari-reader>` is always `dir="rtl" lang="ar"`. English comes back after the beta as a new field, not a breaking change.
- [Certain] **No tashkeel.** Removed `readsDiacritics` from `VoiceConfig` and the element's `tashkeel` / `tashkeel-url` attributes. The UI hint "paste diacritized text" is part of the Q5 element.
- [Certain] Element attributes match section 6 as changed by Khaled on 2026-11-16 (next section): `voice-config`, `voices`, `mode`, `pace`, `highlight`, `auto-scroll`.
- [Certain] The timing file (5.4, binding) and its JSON schema already matched v0.2 field for field; only section references changed.
- [Certain] Milestones renumbered: the old Q6 (tashkeel) is gone; the old Q7 (download + publish) is now Q6.
- **Deferred, with the milestone that owns it:** `pause` / `resume` / `seekToWord` / `render` and the `word` event (Q2, Q4, Q5).

## Khaled's decisions, 2026-11-16 (change the PRD)

These override PRD v0.2 where they differ; the PRD has been updated to v0.3 to match.

**1. Normalization always runs for listeners.** *Superseded on 2026-11-17 (Khaled): normalization is an optional step, on by default, with a listener-facing checkbox and a note that it isn't 100% accurate, so listeners can turn it off and write numbers as words themselves.* Earlier text: no checkbox, no `normalize` attribute, no "digits may be skipped" warning: the listener always hears numbers and abbreviations as words. The element's `normalize` attribute was removed.
- **Off switch** (Khaled, 2026-11-16; no longer developer-only since 2026-11-17, see above). Now also per call: `speak(text, { normalize })` / `synthesize(text, { normalize })`. Original note: `createReader({ normalization: { enabled: false } })`, default `true`, for tests and for comparing against the raw text. **Never shown to listeners**: no attribute, no UI control, not in the element. Built with normalization in Q3, not before, so the option never exists without doing something.

**2. Default mode (CPU) unless the listener chooses accelerated mode (GPU); no automatic switching.**
- [Certain] `createReader({ backend })` takes `'wasm'` (default) or `'webgpu'`; `'auto'` is gone. `reader.setBackend(mode)` switches. The listener sees the two as **الوضع الافتراضي · default mode** and **الوضع المسرَّع · accelerated mode** (`MODE_LABELS`, the only place the names live).
- [Certain] qari never changes mode on its own: the WebGPU→WASM retry on a failed session build was removed, and the PRD's mid-text fallback is dropped. A failure is reported; the listener retries (presses play again) or picks default mode.
- [Certain] Choosing accelerated mode where the probe says it can't run fails straight away with `accelerated-mode-unavailable` instead of loading models first. `probeDevice()` lets a host hide the choice; the demo keeps it visible on purpose so the message can be seen.
- [Certain] If switching to accelerated mode fails, the reader reloads the previous mode (from the cache) before rejecting, so the listener isn't left without a voice. `setVoice` does the same with the previous voice.
- [Certain] (Khaled) **A retry starts from the beginning.** The listener presses play again; qari discards everything from the failed attempt (audio, progress) and reads the whole text again. No automatic retries.
- **Q2 rule:** once sentences stream, a failure stops playback, throws away the queued and played audio, and shows the message; pressing play reads from the first sentence. No resume-from-sentence in qari; Maqroo2 may build that extended version on top. A hung WebGPU run can't be cancelled inside onnxruntime, so Q2 still needs a per-sentence time limit that restarts the Worker and reports `accelerated-mode-failed`.
- [Certain] (Khaled) **Names:** الوضع الافتراضي · default mode (CPU) and الوضع المسرَّع · accelerated mode (GPU), replacing "standard" and "fast", because accelerated mode is not faster on every device. Element attribute `mode="default"` or `mode="accelerated"`. [Likely] "Accelerated" still suggests speed; it is vaguer than "fast", and the names live only in `MODE_LABELS`.

**3. Human-friendly errors.**
- [Certain] Every failure reaches hosts as a `QariError` with a `code`, `text.ar` / `text.en` (shown to listeners), `canRetry`, `suggestsDefaultMode`, and `detail` (technical cause, for logs only, never shown). Codes: `browser-unsupported`, `voice-download-failed`, `voice-unavailable`, `accelerated-mode-unavailable`, `accelerated-mode-failed`, `reading-failed`, `nothing-to-read`, `unexpected`.
- [Certain] A unit test fails if any message contains technical words (WebGPU, WASM, GPU, CPU, model, cache, HTTP, …) in either language. The only names allowed are browser names in `browser-unsupported` ("try the latest Chrome, Safari or Firefox"), on the reasoning that listeners know them.
- How failures are named: a model URL answering 401/403/404/410 or failing its SHA-256 → `voice-unavailable` (retrying won't fix it); network errors, other HTTP statuses, a download cut off → `voice-download-failed`; a session or warm-up failure → `accelerated-mode-unavailable` in accelerated mode, `voice-unavailable` in default mode; a synthesis failure → `accelerated-mode-failed` / `reading-failed`; empty text, or text with no Arabic letters → `nothing-to-read`; a crashed Worker or anything unforeseen → `unexpected`.
- [Guessing] Arabic wording is mine; worth a read by a native speaker before Q5.

**4. Models live in the project, not on a CDN.** `voices/models/` (git-ignored `*.onnx`; delete that `.gitignore` line to commit them). The demo serves the folder at `/models/`; the voice configs point at it with relative URLs. Moving to a CDN later = editing `model.url` / `vocoder.url` in the config; no new option is needed, because the config already is that option. The npm packages publish only `dist/`, so models never make the package heavier.
- [Likely] If you do commit them: vocos22 has ≈ 13.4 M parameters, so the file is around 50 MB; GitHub warns above 50 MB and rejects above 100 MB, and every CI checkout downloads it. Git LFS or keeping them ignored avoids both.
- [Certain] With same-origin model files, CORS stops being a concern for the demo, and Q11 (no requests except model URLs) holds trivially.

## Deployment (Khaled, 2026-11-16)

Full guide: `docs/deployment.md`. Khaled deploys to Hostinger web hosting; GitHub Pages stays as an option.
- [Certain] **One workflow, `.github/workflows/deploy.yml`:** calls `ci.yml`, builds once (`npm run fetch-models` then `npm run build`), then deploys to each target switched on by a repository variable. `QARI_DEPLOY_PAGES=true` → GitHub Pages. `HOSTINGER_HOST` set → rsync over SSH (port `HOSTINGER_PORT`, default 65002). Replaced the earlier Pages-only workflow, so a push no longer fails on a target that isn't set up. CI still also runs on its own on push (twice in total); accepted for simplicity.
- [Certain] **Voice files come from a GitHub Release** (`models-v1`, or the `QARI_MODELS_TAG` variable), downloaded at build time by `tools/fetch-models.ts`. It reads the relative model URLs from `voices/*.json`, keeps files already present, checks `sha256` when given, and fails with a plain message naming what's missing. Tested: no URL, wrong URL, fresh download, already present.
- [Certain] **Server configs in `deploy/`**, all tested here with the same build (tiny models standing in): `apache/.htaccess` (Hostinger/LiteSpeed reads Apache's directives; tested on Apache 2.4 from a `/qari/` subfolder), `caddy/Caddyfile` (Caddy 2.6), `nginx/qari.conf` + `qari-headers.conf`. Each sets the two `Cross-Origin-*` headers, `application/wasm`, compression and caching, and in Chrome each gave `crossOriginIsolated === true` plus a working prepare → read. Engine on the wire: 7.2 MB (Apache gzip), 8.3 MB (Nginx gzip level 1), 6.7 MB (Caddy zstd), from 28.7 MB.
- [Certain] Bugs the tests caught and fixed: an Nginx `location` regex containing `{8}` must be quoted; in the deploy script, `~` inside double quotes is never expanded, so ssh would have read the key and known_hosts from the passwd home instead of `$HOME` (it would have worked on GitHub runners only because the two match).
- [Certain] **Hostinger upload:** rsync `--delete` into `HOSTINGER_PATH` (must be absolute and used only by qari), keeping `.well-known` for certificate checks; the `.htaccess` is copied into the build first. Server key pinned with the `HOSTINGER_KNOWN_HOSTS` secret, or taken on first use with a warning. Tested against a local sshd on port 65002: upload, stale-file removal, `.well-known` kept, a neighbouring site untouched, a wrong pinned key refused, a relative path rejected.
- [Likely] Hostinger's CDN can drop custom headers (one user report quoting Hostinger support). Without them default mode is single-threaded; the guide says how to check and what to turn off.
- [Certain] **Cloudflare Pages / Workers static assets cannot host it today:** 25 MiB per-file limit vs. the 28.7 MB onnxruntime `.wasm`.
- Action majors were the latest tags on 2026-11-16 (`checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `download-artifact@v8`, `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`). `ci.yml` still uses `@v4` for checkout and setup-node; both work.
- Not tested here: LiteSpeed itself, Hostinger's CDN, the workflow on GitHub (no repo yet), real voice files.

## Q0 — tooling (PRD section 9)

| Proposal in the PRD | Verdict | Why |
| --- | --- | --- |
| TypeScript `strict`, npm, ESLint + ESLint Stylistic, no Prettier, lint-staged hooks | **Confirmed** | Khaled's conventions. Hooks live in `.githooks/` (wired by `npm run prepare` → `git config core.hooksPath .githooks`); no husky. |
| `module: commonjs`, `target: ES2023` (the usual NestJS tsconfig) | **Changed** to `module: ESNext`, `moduleResolution: Bundler`, `target: ES2022`, `lib: DOM + WebWorker` | [Certain] This is a browser library consumed by bundlers, `<script type="module">` and jsDelivr. CommonJS output would break `import.meta.url` (needed to find the Worker and the onnxruntime WASM files) and tree-shaking. ES2022 rather than ES2023 so Safari 16.4+ parses the output without down-levelling. Jest still runs the specs as CommonJS through a ts-jest override (pure modules only). |
| Vite library mode | **Confirmed, with one adjustment** | [Certain] Out of the box, Vite's lib mode rewrote the Worker URL to `new URL("/assets/…", "" + import.meta.url)` (root-absolute, and invisible to host bundlers) and, when the URL pointed at an entry, inlined all of onnxruntime into a 76 MB worker. Fix: the Worker is a second lib entry (`dist/synth.worker.js`) and `vite.config.ts` drops Vite's worker/asset URL plugins for the library build only, so `dist/index.js` keeps the literal `new URL('./synth.worker.js', import.meta.url)`. Verified: a separate Vite app importing `dist/` bundles the Worker, onnxruntime and its `.wasm`, and the probe runs in Chrome. `onnxruntime-web` stays external. Type declarations come from `tsc --emitDeclarationOnly`, not a plugin. |
| Jest + ts-jest for pure logic | **Confirmed** | Specs sit next to the file (`*.spec.ts`); no network, no browser APIs. |
| Playwright on Chromium for the browser | **Confirmed** | [Certain] CI has no real voices, so `tools/make-test-models.py` builds two tiny ONNX files (≈ 2 KB) with exactly the real models' input/output names and types (incl. `durations`); the "vocoder" emits a tone. The browser test runs the real Worker, onnxruntime-web WASM, OPFS cache and playback: prepare Male sound → play → switch to Female sound with no download → reload → prepare again with no download. Also asserts that headless Chromium (no real GPU) is probed onto WASM. Passes with and without COOP/COEP. Real-voice quality and Safari are manual (see "What only Khaled can verify"). |
| GitHub Actions: lint, typecheck, test, browser test, build; publish from tags on `main` | **Confirmed** | `ci.yml` runs on every push/PR; `release.yml` publishes on a `v*` tag only when the tagged commit is on `main` and CI passes. Needs an `NPM_TOKEN` secret (set before Q6). |
| Monorepo `packages/qari-core`, `packages/qari-element`, `demo/`, `voices/` | **Confirmed** | npm workspaces. The demo is not published; it imports the packages from source through a Vite alias. |
| Node 24.11+ | **Confirmed** (`.nvmrc`, `engines`, CI) | The sandbox used to scaffold this ran Node 22; everything passed there too. |
| — | **Added** `@webgpu/types` | Type-checks the probe's WebGPU calls without `any`. |
| — | **Pinned** TypeScript `~6.0` | [Certain] typescript-eslint 8.x supports `<6.1`; ts-jest supports `<7`. TypeScript 7 is out but both tools reject it today. |

## Package names

- [Certain] `@khaledelansari/qari-core`, `@khaledelansari/qari-element`, and the unscoped `qari`, `qari-core`, `qari-element` all returned 404 on the npm registry on 2026-11-16 (unclaimed).
- [Guessing] The scope `@khaledelansari` works only if the npm account or org of that name is Khaled's. Used as the working name; confirm before Q6.
- Licence type: still open in the PRD (MIT or Apache-2.0). No `LICENSE` file until it is picked; packages say `"license": "SEE LICENSE IN README"` meanwhile. Needed before Q6.

## Q1 — voices

- [Certain] From nipponjo's `tts_arabic` source: the acoustic model takes `token_ids` (int64 `[1, T]`), `pace` (float32, > 1 is faster), `speaker` (int32), `pitch_mul`, `pitch_add` (float32), and returns a mel spectrogram `[1, 80, frames]`. Vocos takes `mel_spec` and `denoise` (float32, default 0.005) and returns `[1, samples]` at 22,050 Hz. Output is peak-normalised to 0.9, as in the Python package.
- **VoiceConfig change:** a nipponjo voice is two ONNX files (Mixer-TTS-128 + Vocos 22k). The PRD's config has one `model`. Added an optional `vocoder` field with the same shape. Piper voices leave it out.
- **`sizeBytes` is optional.** [Certain] The download progress uses `Content-Length` first and falls back to `sizeBytes`; the example configs set it (measured 2026-11-17), so the demo's download bar knows the full total before the second file starts.
- [Certain] Example configs use **local** model files: `models/mixer128.onnx` and `models/vocos22.onnx`, relative to the config, served by the demo from `voices/models/` (Khaled downloads them by hand; see that folder's README). Superseded the earlier guessed Hugging Face URLs.
- [Certain] Versions in the example configs come from the upload timestamps in `tts_arabic/urls.py`: mixer128 `2024-09-20`, vocos22 `2024-09-21`.
- **Timings in Q1 (superseded by Q4 below):** both configs say `timings: "native"` with `durationOutput: "durations"` (the PRD target). The stock mixer128 is the *unpatched* model, so it has no `durations` output yet; the adapter returns audio without durations and the reader emits a `warning`. Q4 switches the file to the patched `mixer128_dur.onnx` (in `voices/models/`) and turns the warning into a load error.
- "Female sound" is the same model files with `speaker: 3`. `reader.setVoice()` reuses the loaded sessions when the model files are identical, so switching between the two costs no download and no session rebuild.

## Q1 — text front end (arabic-phonetiser)

- [Certain] Port of `tts_arabic/text/phonetise_buckwalter.py` + `text/__init__.py` + `symbols.py` (Nawar Halabi's Arabic-Phonetiser as adapted by nipponjo). Licence type of the original: CC BY-NC 4.0 (recorded in `THIRD_PARTY.md`).
- [Certain] The port reproduces Python quirks on purpose so token ids match: `'r'` resets emphasis (an accidental string concatenation in the original turns the intended `['r', 'l']` exemption into a list with one odd string); a shadda on a multi-choice phone duplicates the choice list; empty words from double spaces emit an extra word separator; only the first pronunciation is used.
- [Certain] Checked against the Python original on 40 sentences (transliteration, phonemes, tokens and ids all equal) (`fixtures/phonetiser-golden.json`, generated by `tools/gen-phonetiser-golden.py`).
- **Deviation (added step, outside the port):** before tokenising, the adapter maps Arabic punctuation to what the tokenizer knows (`،`→`,`, `؟`→`?`, `؛`→`,`, `:`→`,`), then **drops every character outside the Arabic block** except whitespace and `. , ? !`, then drops tatweel. [Certain] Without the second step the phonetiser reads ASCII as Buckwalter transliteration: a pasted "MIT" was tokenised as `T` (ط), and `$`, `*`, `<` would be read as ش, ذ, إ. Arabic-Indic digits stay but make no sound until normalization (Q3). Not NFKC: Unicode normalization reorders shadda after fatha, which the phonetiser depends on. Arabic presentation forms (U+FB50–FEFF, from some PDFs) are dropped too; Q3 should map them to base letters.
- Unknown tokens are dropped and reported (`warning` event) rather than thrown; the Python original raises `KeyError`.

## Q1 — runtime

- [Certain] `onnxruntime-web` 1.31.1, imported as `onnxruntime-web/webgpu` (WASM + WebGPU in one bundle) inside the Worker only.
- [Certain] Cost of that choice: the WebGPU bundle's `.wasm` is 28.7 MB (7.3 MB gzipped) vs 14.8 MB for the plain WASM build. With default mode now the default, most listeners pay for WebGPU code they don't use. Q2 item: import `onnxruntime-web/wasm` in default mode and the WebGPU build only when accelerated mode is chosen.
- [Certain] Pace is a speed multiplier everywhere in qari (1 = normal, above 1 = faster), matching nipponjo's `pace`. A Piper adapter will convert it (`length_scale = 1 / pace`), so Kareem's 0.85 length scale becomes `defaultPace ≈ 1.18`.
- **Script-tag / CDN use: dropped** (Khaled, 2026-11-16). `dist/synth.worker.js` imports `onnxruntime-web/webgpu` by bare name, which bundlers resolve and a plain jsDelivr `<script>` cannot. qari is installed from npm and bundled; the CDN snippet is out of the PRD.
- WASM threads: `min(4, hardwareConcurrency)` when `crossOriginIsolated`, else 1.
- `ortWasmPaths` option: hosts that serve onnxruntime's `.wasm` from their own path set it; by default onnxruntime resolves it next to its own module. No CDN default, so Q11 (no requests except model URLs) holds.
- **Accelerated-mode probe** (runs inside the Worker, where the sessions live, once per Worker): no `navigator.gpu`, no adapter, or `isFallbackAdapter` → unavailable; then a compute-shader micro-benchmark (two runs, the second is measured, 2 s budget). Available only at **5 GFLOPS** or more [Guessing on the threshold: SwiftShader measured 0.2 and single-thread JS 0.47 in the research; tune from telemetry]. Vendor strings are never read. Since 2026-11-16 the probe only decides whether accelerated mode can be offered; it never picks the mode.
- [Likely] The research measured Mixer-TTS + Vocos *faster on CPU than WebGPU* on the M3 Pro, so accelerated mode can be slower for these voices on some devices. That is why the CPU is the default and the GPU mode is called "accelerated", not "fast".
- **OPFS cache**: directory `qari-models`, file name = SHA-256 of `url#version`, plus a `.ok` marker holding the byte length, written last. A file without a matching marker is treated as missing (interrupted download). Writes use `createWritable` where it exists and `createSyncAccessHandle` otherwise (older Safari, Worker only). If OPFS is unavailable (non-HTTPS, private mode) the model is used from memory and a `warning` is emitted.
- `sha256` in the config, when present, is checked after download and before caching.
- **Warm-up:** after loading, the Worker synthesises one short word and discards it, so the first real sentence doesn't pay session warm-up. Shows as the `warming` stage.
- **Playback:** one `AudioContext` on the main thread, resumed synchronously at the start of `speak()` so Safari's autoplay rule sees the user gesture. Q1 plays one block of text as one sentence; splitting, gapless streaming, pause/resume belong to Q2.

## What only Khaled can verify (Q1 "done when")

This workspace has no real voice files and no Safari, so these are open:
1. Put `mixer128_dur.onnx` (see `voices/models/README.md`) and `vocos22.onnx` into `voices/models/`.
2. Male sound and Female sound actually speak, on Chrome and Safari, from `npm run dev` over HTTPS or localhost.
3. OPFS cache survives a reload on Safari (Chrome is covered by the browser test).
4. ~~The sizes (`sizeBytes`)~~ (done 2026-11-17) and, if wanted, `sha256` of the two files, to fill into `voices/*.json`.
5. On a device with a real GPU (your Pixel 8 Pro, the M3): accelerated mode loads and reads, and switching back to default mode works.

## Not built yet (by milestone)

## Licence and credit (Khaled, 2026-11-17)

- **Code: Apache-2.0 with a NOTICE file**, not a non-commercial licence. The packages ship no models, qari works with any voice, and a non-commercial code licence would only block people bringing commercially licensed voices. Apache-2.0 requires redistributors to keep the NOTICE file ("This product includes قارئ (Qari) by …"). `LICENSE` and `NOTICE` are added once the public repo exists (the NOTICE needs its URL).
- **Visible credit by default:** `<qari-reader>` shows `<qari-credit>` ("يعمل بـ قارئ" / "Powered by Qari · قارئ", following the page's or its own `lang`); `credit="off"` hides it. `<qari-credit>` is exported for hosts that use `qari-core` directly. It links to `QARI_HOMEPAGE` (`qari-credit.element.ts`), empty until the repo exists, so it's plain text for now. The credit is a request, not a licence term.
- **Models stay non-commercial** (nipponjo); the README says so next to the licence.

## Q3: normalization (started 2026-11-17, numbers first)

- [Certain] **Numbers → words** (`normalization/arabic-numbers.ts`), ported and extended from Maqroo2's `ar_numbers.py`: 0 to 999,999,999,999 with Arabic counting rules (أَلْفٍ / أَلْفَيْنِ / ثَلَاثَةِ آلَافٍ / أَحَدَ عَشَرَ أَلْفًا / مِئَةِ أَلْفٍ, the same for millions and billions); Western, Arabic-Indic and Persian digits; thousands separators (`1,500`, `١٬٥٠٠`); decimals (`3.5`, `٢٫٠٥` → "… فَاصِلَة …", a fraction with a leading zero read digit by digit); percent (`50%`, `٥٠٪` → "… بِالمِئَةِ"). A leading zero or a number above the range is read digit by digit (phone numbers, codes). A prefix written onto a number stays on its first word (وَ12 → وَاثْنَيْ عَشَرَ, hamzat al-wasl's kasra dropped); punctuation after it stays on its last word, so pauses don't move.
- [Certain] **Known limit (as in Maqroo2):** always genitive case, counted noun assumed masculine. "وَلَهُ ٣ أَبْنَاءٍ" is read ثَلَاثَةٍ where the grammar wants ثَلَاثَةُ. Fixing it needs case and gender from the surrounding words.
- [Certain] **Word map:** `normalizeForSpeech(text)` returns spoken words, each with its display word's index. Timings follow the spoken words: a display word spans all of its spoken words (`spokenIndexes`), and each spoken word's `said` holds its spoken form when it differs from the text. `stats.words` counts *display* words heard ("1950" once).
- [Certain] **Developer switch** built: `createReader({ normalization: { enabled: false } })`, passed per synthesis to the adapter.
- **Not yet in Q3:** abbreviations dictionary, dates and times, currency and units, ordinals, case and gender agreement, Section 4 table and gold set (PRD).

## Q4: word timings (started 2026-11-17, ahead of Q2 and Q3)

- [Certain] **Model:** `scripts/patch-durations.py` adds one `Identity` node exposing `/Cast_4_output_0` (int64 frames per token, which the model already computes to stretch tokens) as output `durations`. `mel_spec` is unchanged and the frame counts sum to its length. The result matched the `mixer128_dur.onnx` in `maqroo2-test/maqroo2-word-sync` byte size and outputs. Both voice configs now load `models/mixer128_dur.onnx`, version `2024-09-20+durations`.
- [Certain] **Load error, not a warning:** a voice with `timings: "native"` whose model lacks the `durationOutput` fails to load as `voice-unavailable` (detail names the patch tool).
- [Certain] **Words:** a displayed word is a run of non-whitespace in the text passed to `speak()`. The phonetiser ends every word with `_+_`, so each separator group is one word; a punctuation-only word joins the word before it (as the phonetiser does), and a word with nothing readable (Latin, symbols) has no group and gets a zero-length timing where the reading is. If the group count and the readable-word count differ, the audio plays without timings and a `warning` says why.
- [Certain] **Seconds:** frames × (audio samples ÷ total frames ÷ sample rate), so no hop size is configured (it comes out at 256 at 22,050 Hz). A word runs from its first sounding token to its last, so the pause after a word or a comma belongs to no word. Seconds are rounded to 3 decimals, as in the timing file.
- [Certain] **API:** `Synthesis.timings` (`duration`, `words`, `displayWords` in the timing-file shapes, plus `ranges` with UTF-16 offsets per display word) and a reader `word` event `{ displayIndex, text, start, end, charStart, charEnd }`, emitted as each heard word starts (zero-length words are skipped). Also a `timings` event with the whole text's `WordTimings` as playback starts, and `reader.position()` (seconds into the audio being heard, or null), so a host can draw a timeline and move a playhead (the demo's timing ribbon uses both). `WordTimings.stats` sums a reading up: heard `words`, `wordsPerMinute` (heard words over the whole audio, pauses included) and `pausePercent` (share of the audio inside no word), both to one decimal and computed from frames, not rounded seconds. Not part of the timing file. Playback position is `AudioContext.currentTime` minus the start time and `outputLatency` where the browser reports it.
- [Likely] Timing accuracy is the model's own: the frames it used to make the audio. Checked in Chromium (all 10 words of the demo sentence highlighted in order over 4.75 s); how it *sounds* against the highlight, and Safari/Firefox latency, are for Khaled to check by ear.
- **Not yet:** `said` for spoken forms that differ from the text (needs Q3 normalization); sentence splitting (Q2) will need offsets per sentence; writing a `TimingFile` with an audio name (Q6, with WAV download).

Q2 sentence splitting and streaming · Q3 normalization and the word map · Q4 timings (`TimingFile` type and JSON schema are already in `qari-core` so the binding format is fixed early) · Q5 the real `<qari-reader>` (Q0 has a stub that registers the tag) · Q6 WAV download, docs and npm 0.1.0 beta.
