# Package plan: core, web, node, element

Status: **plan, agreed in direction on 2026-11-16; not built.** The PRD (v0.3) doesn't include this yet. Today the repo has two packages, `qari-core` (browser engine) and `qari-element` (stub).

**Names are placeholders.** The npm scope is undecided (parked by Khaled), so this plan writes `<scope>/core`, `<scope>/web` and so on. The packages keep their current names (`@khaledelansari/qari-*`) until it's decided, and renaming later is a find-and-replace.

## Goal

قارئ produces Arabic speech (plus word timings) from text in three places, through one engine:

| Surface | For | Main call |
| --- | --- | --- |
| **Web component** | Sites that want a ready reader UI | `<qari-reader>` |
| **Web API** | Sites that want to play, or to generate and store audio, in the visitor's browser | `speak(text)`, `render(text)` |
| **Node API** | Backends (e.g. Qamoos in NestJS) that generate audio on request and store it | `render(text)` |

Framework wrappers (React, Angular, Vue) come later as thin layers over the web component.

## The packages

| Package | Runs in | Contains | Heavy dependencies |
| --- | --- | --- | --- |
| `<scope>/core` | Anywhere (plain TypeScript: no DOM, no Node APIs) | Text front end (phonetiser), normalization + word map (Q3), sentence splitting (Q2), timing math + timing file (Q4), WAV encoding (Q6), voice config, errors, model-run logic (tokens → tensors → audio + durations) | none (types only from `onnxruntime-common`) |
| `<scope>/web` | Browser | Worker, `onnxruntime-web`, model download + OPFS cache, accelerated-mode probe, playback; `createReader()` with `speak` / `pause` / `resume` / `stop` / `seekToWord` / `render` | `onnxruntime-web` (28.7 MB engine) |
| `<scope>/node` | Node 24+ | `onnxruntime-node`, model files from a path or URL with a disk cache, request queue, length limit; `createSynthesizer()` with `render` | `onnxruntime-node` (native binaries) |
| `<scope>/element` | Browser | `<qari-reader>` Web Component: text box, voice + mode pickers, play / pause / stop, read-along, download | `<scope>/web` |
| later: `<scope>/react`, `/angular`, `/vue` | Browser frameworks | Typed props and events over `<qari-reader>` | the framework (peer dependency) |

Why separate packages and not one package with subpaths: a browser site would otherwise install onnxruntime-node's native server binaries, and a NestJS service would install the 28.7 MB browser engine. Separate packages keep every install to what it runs.

**Versioning:** all packages release together with the same version number (lockstep), so `core 0.3` is never mixed with `web 0.2`.

## One API shape on both runtimes

`render(text)` returns the same thing everywhere, so audio made in a browser or on a server can be stored and replayed with read-along:

```ts
interface RenderResult {
  audio: Uint8Array;          // WAV (web also offers it as a Blob)
  timings: TimingFile;        // PRD 5.4, binding
  wordMap: WordMap;           // displayed word ↔ spoken words (Q3)
}
```

```ts
// Browser
import { createReader } from '<scope>/web';
const reader = await createReader({ voice: maleSound });
await reader.speak(text);                       // play with read-along
const { audio, timings } = await reader.render(text); // or generate and store

// Node (NestJS service)
import { createSynthesizer } from '<scope>/node';
const synth = await createSynthesizer({ voice: maleSound, cacheDir: '/var/cache/qari', maxCharacters: 5000 });
const { audio, timings } = await synth.render(text);   // store audio + timings
```

Shared rules:
- **Errors:** the same `QariError` codes on both. In Node, hosts map them to HTTP responses; `text.ar` / `text.en` are still safe to show end users.
- **Normalization:** always on; the developer-only `{ enabled: false }` exists on both and is never exposed in any UI.
- **Retry:** a failure discards the whole attempt; calling again starts from the beginning.
- **Output:** WAV only. MP3 / Opus conversion is the host's job (e.g. ffmpeg in NestJS), so no package carries an encoder.

## The model-run logic lives in core

The Mixer-TTS + Vocos logic (build `token_ids` / `pace` / `speaker`, run the acoustic model, run the vocoder, read `durations`, normalise the peak) is the same in the browser and in Node; only the runtime differs. Core holds that logic and receives a session from outside:

```ts
interface InferenceProvider {           // web: onnxruntime-web; node: onnxruntime-node
  createSession(bytes: Uint8Array): Promise<InferenceSessionLike>;
}
```

[Likely] Both onnxruntime builds share their `InferenceSession` / `Tensor` types through `onnxruntime-common`, so core can type against that without depending on either runtime. Confirm at the split.

## Node specifics

| Concern | Plan |
| --- | --- |
| **Models** | `model.url` can be a file path or an HTTPS URL; downloads are cached in `cacheDir`, keyed by URL + version (same rule as the browser), with `sha256` checked when given. |
| **Concurrency** | Sessions load once per synthesizer and are shared; requests run through a queue (default one at a time, `concurrency` option), so ten requests don't load ten models. |
| **Abuse** | `maxCharacters` (default proposal: 5,000) rejects longer text with a clear error; rate limiting stays the host's job (e.g. `@nestjs/throttler`). |
| **Hardware** | CPU only at first (`threads` option). [Likely] Mixer-TTS + Vocos ran at RTF ≈ 0.016 on 4 CPU threads in the bench, so a server needs no GPU. |
| **Long text** | Split into sentences (Q2's splitter, from core), synthesize each, join into one WAV and one timing file. |
| **Tests** | Real (tiny) models run in plain Node in CI, with no browser: faster than the Playwright tests. |

## Where today's files go

| Today (`qari-core/src/…`) | Goes to | Change needed |
| --- | --- | --- |
| `frontends/arabic-phonetiser/*`, `audio/peak-normalize.ts`, `timings/timing-file.ts`, `voice/voice-config.ts`, `errors/qari-error.ts`, `runtimes/runtime-adapter.ts` | core | none (already plain TypeScript) |
| `runtimes/mixer-tts.adapter.ts` | core | takes an `InferenceProvider` instead of importing `onnxruntime-web` |
| `runtimes/ort-session.ts`, `backend/backend-probe.ts`, `models/model-store.ts` (OPFS), `playback/pcm-player.ts`, `reader/*`, `worker/*`, `synth.worker.ts`, `start-worker.ts` | web | imports from core |
| (new) session provider, disk cache, queue, `createSynthesizer` | node | new code |
| `qari-element/*` | element | depends on web instead of core |

## Milestones (proposed update to PRD section 10)

| # | Milestone | Done when |
| --- | --- | --- |
| Q2a | **Split** into core / web / element (node comes later); no behaviour change | All current tests pass unchanged; core has no DOM or browser imports (checked by a lint rule) |
| Q2 | Sentence splitting (core), streaming gapless playback, pause/resume/stop, warm-up (web) | 20,000 characters play smoothly |
| Q3 | Normalization + word map + abbreviation dictionary (core) | Section 4 table and gold set pass |
| Q4 | Native timings + timing file + displayed-word spans (core); Kareem duration patch | PRD Q5 passes |
| **Q4n** | **Node package:** provider, disk cache, queue, `maxCharacters`, `render` | Same text gives the same timing file shape as the browser; NestJS example works; CI runs real tiny models in Node |
| Q5 | `<qari-reader>` (element) | Section 8 behaviours pass |
| Q6 | WAV download, docs, first beta of all packages, published together | Published; Maqroo2 "Try the voice" switches to قارئ |
| later | React, Angular, Vue wrappers | Each has a demo; the element's API stays the source of truth |

Q4n and Q5 don't depend on each other, so their order can swap. Q2a comes first because every milestone after it adds core code, and splitting later means moving more files and imports.

## Wrappers (later)

[Likely] They'll be thin:
- **React 19:** handles custom elements natively (properties and events), so `<scope>/react` is mostly types.
- **Angular:** uses custom elements with `CUSTOM_ELEMENTS_SCHEMA`; the wrapper adds types and form integration.
- **Vue:** works with custom elements out of the box.

The real work is a clean element API (attributes, properties, events, parts), done in Q5.

## Open

- npm scope (parked).
- Default `maxCharacters` for Node (proposal: 5,000).
- Whether Node should later offer GPU (CUDA) as an option.
- PRD update: scope, packages, Node API, Q2a and Q4n (not done yet).
