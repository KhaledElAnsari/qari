# Builds two tiny ONNX models with the same inputs/outputs as nipponjo Mixer-TTS-128 (+ the `durations` patch) and Vocos 22k.
# They make no speech (the "vocoder" emits a 440 Hz tone) but let browser tests run the real Worker, onnxruntime-web,
# the OPFS cache and playback without downloading the real voices.
# Run: python3 -I tools/make-test-models.py tests/fixtures   (needs: pip install onnx onnxruntime numpy)
import math
import pathlib
import sys

import numpy as np
import onnx
import onnxruntime
from onnx import TensorProto, helper, numpy_helper

OPSET = 17
IR_VERSION = 9
MEL_BANDS = 80
FRAMES_PER_TOKEN = 2
HOP_SAMPLES = 256


def acoustic_model():
    inputs = [
        helper.make_tensor_value_info('token_ids', TensorProto.INT64, [1, 'tokens']),
        helper.make_tensor_value_info('pace', TensorProto.FLOAT, [1]),
        helper.make_tensor_value_info('speaker', TensorProto.INT32, [1]),
        helper.make_tensor_value_info('pitch_mul', TensorProto.FLOAT, [1]),
        helper.make_tensor_value_info('pitch_add', TensorProto.FLOAT, [1]),
    ]
    outputs = [
        helper.make_tensor_value_info('mel_spec', TensorProto.FLOAT, [1, MEL_BANDS, 'frames']),
        helper.make_tensor_value_info('durations', TensorProto.INT64, [1, 'tokens']),
    ]
    constants = [
        numpy_helper.from_array(np.array([1], dtype=np.int64), 'axis_one'),
        numpy_helper.from_array(np.array([1, MEL_BANDS, FRAMES_PER_TOKEN], dtype=np.int64), 'mel_repeats'),
    ]
    nodes = [
        helper.make_node('Cast', ['token_ids'], ['tokens_float'], to=TensorProto.FLOAT),
        helper.make_node('Cast', ['speaker'], ['speaker_float'], to=TensorProto.FLOAT),
        helper.make_node('Mul', ['pace', 'pitch_mul'], ['pace_pitch']),
        helper.make_node('Add', ['pitch_add', 'speaker_float'], ['offset']),
        helper.make_node('Add', ['pace_pitch', 'offset'], ['scale']),
        helper.make_node('Mul', ['tokens_float', 'scale'], ['scaled']),
        helper.make_node('Unsqueeze', ['scaled', 'axis_one'], ['scaled_3d']),
        helper.make_node('Tile', ['scaled_3d', 'mel_repeats'], ['mel_spec']),
        helper.make_node('Shape', ['token_ids'], ['token_shape']),
        helper.make_node('ConstantOfShape', ['token_shape'], ['durations'],
                         value=numpy_helper.from_array(np.array([FRAMES_PER_TOKEN], dtype=np.int64))),
    ]
    graph = helper.make_graph(nodes, 'tiny_acoustic', inputs, outputs, constants)
    return helper.make_model(graph, opset_imports=[helper.make_opsetid('', OPSET)], ir_version=IR_VERSION)


def vocoder_model():
    inputs = [
        helper.make_tensor_value_info('mel_spec', TensorProto.FLOAT, [1, MEL_BANDS, 'frames']),
        helper.make_tensor_value_info('denoise', TensorProto.FLOAT, [1]),
    ]
    outputs = [helper.make_tensor_value_info('wave', TensorProto.FLOAT, [1, 'samples'])]
    tone = np.array([[[0.5 * math.sin(2 * math.pi * 440 * k / 22050) for k in range(HOP_SAMPLES)]]], dtype=np.float32)
    constants = [
        numpy_helper.from_array(tone, 'tone'),
        numpy_helper.from_array(np.array([2], dtype=np.int64), 'axis_two'),
        numpy_helper.from_array(np.array([1, -1], dtype=np.int64), 'flat_shape'),
        numpy_helper.from_array(np.array([0], dtype=np.float32), 'zero'),
    ]
    nodes = [
        helper.make_node('ReduceMean', ['mel_spec'], ['mel_mean'], axes=[1], keepdims=0),
        helper.make_node('Unsqueeze', ['mel_mean', 'axis_two'], ['mel_mean_3d']),
        helper.make_node('Mul', ['mel_mean_3d', 'zero'], ['silence']),
        helper.make_node('Mul', ['denoise', 'zero'], ['no_denoise']),
        helper.make_node('Add', ['silence', 'no_denoise'], ['base']),
        helper.make_node('Add', ['base', 'tone'], ['frames_of_tone']),
        helper.make_node('Reshape', ['frames_of_tone', 'flat_shape'], ['wave']),
    ]
    graph = helper.make_graph(nodes, 'tiny_vocoder', inputs, outputs, constants)
    return helper.make_model(graph, opset_imports=[helper.make_opsetid('', OPSET)], ir_version=IR_VERSION)


def check(acoustic_path, vocoder_path):
    acoustic = onnxruntime.InferenceSession(acoustic_path)
    vocoder = onnxruntime.InferenceSession(vocoder_path)
    mel, durations = acoustic.run(None, {
        'token_ids': np.array([[10, 11, 4, 1]], dtype=np.int64), 'pace': np.array([1], dtype=np.float32),
        'speaker': np.array([1], dtype=np.int32), 'pitch_mul': np.array([1], dtype=np.float32), 'pitch_add': np.array([0], dtype=np.float32),
    })
    wave = vocoder.run(None, {'mel_spec': mel, 'denoise': np.array([0.005], dtype=np.float32)})[0]
    assert mel.shape == (1, MEL_BANDS, 4 * FRAMES_PER_TOKEN), mel.shape
    assert durations.tolist() == [[FRAMES_PER_TOKEN] * 4], durations
    assert wave.shape == (1, 4 * FRAMES_PER_TOKEN * HOP_SAMPLES), wave.shape


out_dir = pathlib.Path(sys.argv[1])
out_dir.mkdir(parents=True, exist_ok=True)
acoustic_path = str(out_dir / 'tiny-acoustic.onnx')
vocoder_path = str(out_dir / 'tiny-vocoder.onnx')
for model, path in [(acoustic_model(), acoustic_path), (vocoder_model(), vocoder_path)]:
    onnx.checker.check_model(model)
    onnx.save(model, path)
check(acoustic_path, vocoder_path)
print('wrote and checked', acoustic_path, vocoder_path)
