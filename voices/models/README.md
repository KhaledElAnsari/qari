# Local voice models

Put the model files here. The demo serves this folder at `/models/`, and the voice configs in `voices/` point at it with relative URLs (`models/mixer128.onnx`), so `npm run dev` reads the voices from your own machine.

| File | Used by | Where to get it |
| --- | --- | --- |
| `mixer128.onnx` | Male sound, Female sound (acoustic model) | nipponjo's `tts_arabic` downloads (or the Hugging Face repo `nipponjo/tts-arabic-onnx`) |
| `vocos22.onnx` | Male sound, Female sound (vocoder, 22,050 Hz) | same place |
| `mixer128_dur.onnx` | Q4: same model with the `durations` output added | made by the duration patch (research/word-timings-mixer-tts.md) |

Licence type of these files: non-commercial.

`*.onnx` here is git-ignored (see `.gitignore`), so the files stay out of commits and CI. The npm packages never include them either: each package publishes only its `dist/`.

To use a CDN or another server later, change `model.url` and `vocoder.url` in the voice config to absolute URLs. Nothing else changes. When you replace a file with a different one, bump `version` too: the browser cache is keyed by URL + version.
