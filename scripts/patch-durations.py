"""Adds a `durations` output to nipponjo's Mixer-TTS ONNX model, for word timings (Q4).

The model already computes how many mel frames each input token lasts (it uses them to stretch the
tokens before decoding); the stock export just doesn't return them. This exposes that tensor,
`/Cast_4_output_0` (int64, [batch, token]), as a second output named `durations`. Nothing else changes:
`mel_spec` is identical, and the frame counts sum to its length.

Run: python3 -I scripts/patch-durations.py voices/models/nipponjo/mixer128.onnx voices/models/nipponjo/mixer128_dur.onnx
Needs: pip install onnx (and onnxruntime + numpy for the check this script runs at the end).
"""
import sys

import onnx
from onnx import TensorProto, helper

DURATIONS_TENSOR = '/Cast_4_output_0'
OUTPUT_NAME = 'durations'


def patch(source: str, target: str) -> None:
    model = onnx.load(source)
    graph = model.graph
    if any(output.name == OUTPUT_NAME for output in graph.output):
        sys.exit(f'{source} already has a "{OUTPUT_NAME}" output.')
    if not any(DURATIONS_TENSOR in node.output for node in graph.node):
        sys.exit(f'{source} has no tensor {DURATIONS_TENSOR}; is it nipponjo mixer128?')
    graph.node.append(helper.make_node('Identity', [DURATIONS_TENSOR], [OUTPUT_NAME], name='durations_out'))
    graph.output.append(helper.make_tensor_value_info(OUTPUT_NAME, TensorProto.INT64, ['batch', 'token']))
    onnx.checker.check_model(model)
    onnx.save(model, target)


def check(target: str) -> None:
    """Runs a short sentence and checks the frame counts add up to the mel length."""
    import numpy as np
    import onnxruntime as ort

    session = ort.InferenceSession(target, providers=['CPUExecutionProvider'])
    ids = np.array([[22, 4, 10, 38, 4, 1]], dtype=np.int64)  # any short valid token sequence
    feeds = {
        'token_ids': ids,
        'pace': np.array([1.0], np.float32),
        'speaker': np.array([1], np.int32),
        'pitch_mul': np.array([1.0], np.float32),
        'pitch_add': np.array([0.0], np.float32),
    }
    feeds = {name: value for name, value in feeds.items() if name in {i.name for i in session.get_inputs()}}
    mel, durations = session.run(['mel_spec', OUTPUT_NAME], feeds)
    assert durations.shape == ids.shape, (durations.shape, ids.shape)
    assert int(durations.sum()) == mel.shape[-1], (int(durations.sum()), mel.shape)
    print(f'ok: {durations.shape[1]} tokens, {int(durations.sum())} frames = mel length')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    patch(sys.argv[1], sys.argv[2])
    check(sys.argv[2])
