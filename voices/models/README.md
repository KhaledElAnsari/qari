# Local voice models

Put the model files here, one folder per model family: `nipponjo/`, `bayan/` and `nabra/`. The demo serves this folder at `/models/`, and the voice configs in `voices/` point at it with relative URLs (`models/nipponjo/mixer128_dur.onnx`), so `npm run dev` reads the voices from your own machine.

| Folder | Used by | Where to get it |
| --- | --- | --- |
| `nipponjo/` (2 files) | Sami, Amal: `mixer128_dur.onnx`, `vocos22.onnx` | nipponjo's `tts_arabic` downloads (or the Hugging Face repo `nipponjo/tts-arabic-onnx`): take `vocos22.onnx` as is, and make `mixer128_dur.onnx` from `mixer128.onnx` with `python3 -I scripts/patch-durations.py voices/models/nipponjo/mixer128.onnx voices/models/nipponjo/mixer128_dur.onnx` (needs `pip install onnx onnxruntime numpy`; see Altered Models below) |
| `bayan/` (7 files) | Murad (Bayan): `decoder_step_fp16.onnx`, `text_encoder_fp16.onnx`, `lt_sample_fp16.onnx`, `codec_decoder.onnx`, `bayan_config.json`, `voice_ctx.bin`, `bos_emb.bin` | Exported from `Bayan-Arabic-TTS-v1.0.nemo` by the `bayan-onnx` project (`export/export_bayan_onnx.py --fp16`): copy its fp16 graphs (WebGPU-safe conversion) and the **fp32** codec |
| `nabra/` (4 files) | Nabra: `nabra_fp16.onnx`, `nabra_config.json`, `voice_af_msa.bin`, `espeak-ng.wasm` | Exported from `oddadmix/Nabra-82M-v0.1` by the `nabra-onnx` project (`export/export_nabra_onnx.py --fp16`): copy `nabra_fp16.onnx`, `nabra_config.json` and `voice_af_msa.bin` from its `web/model/`, and `espeak-ng.wasm` from its `espeak/qari/` (`espeak/build.sh`) |

Licence type of the nipponjo files: non-commercial. Bayan: NVIDIA Open Model License. Nabra: Apache-2.0, except `espeak-ng.wasm` (espeak-ng 1.52.0 and its data): GPL-3.0-or-later.

The folders are git-ignored as a whole (see `.gitignore`; Bayan's and Nabra's config and `.bin` files belong with their models), so the files stay out of commits and CI. The npm packages never include them either: each package publishes only its `dist/`.

To use a CDN or another server later, change `model.url` and `vocoder.url` in the voice config to absolute URLs. Nothing else changes. When you replace a file with a different one, bump `version` too: the browser cache is keyed by URL + version.

## Altered Models

We alter some models to add features qari needs, mainly word timings.

For example, `mixer128_dur.onnx` is an altered version of nipponjo's `mixer128.onnx`. In other words, "same same but different": same weights and same voice, patched to also output how long each sound lasts, which qari uses for word timings.

![Same same but different](https://media.tenor.com/tm4JV1Qs15AAAAAC/the-interview-james-franco.gif)
