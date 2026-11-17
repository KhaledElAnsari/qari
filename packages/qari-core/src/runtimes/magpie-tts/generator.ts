import * as ort from 'onnxruntime-web/webgpu';
import type { Backend } from '../../backend/backend-probe';
import type { BayanConfig } from './bayan-config';
import { isFinishedTake, mulberry32, newPriorState, nextPrior } from './sampling';

/** Bayan's four ONNX graphs (bayan-onnx/export/export_bayan_onnx.py); every one runs batch 2: conditional + CFG row. */
export interface BayanGraphs {
  textEncoder: Uint8Array;
  decoderStep: Uint8Array;
  ltSample: Uint8Array;
  codecDecoder: Uint8Array;
}

/** Codes for one take of a sentence. */
export interface Take {
  /** codes[codebook][frame] */
  codes: number[][];
  frames: number;
  eosFrame: number | null;
  lastAtt: number;
  textLength: number;
  finished: boolean;
  steps: number;
  /** The text position the decoder attended to at each step (for word timings). */
  attSteps: number[];
}

export interface TakeOptions {
  seed: number;
  /** Max decoder frames; defaults to the config's max_decoder_steps. */
  maxFrames?: number;
}

/**
 * The generation loop of web/bayan-engine.js (generateCodes / decodeCodes), unchanged: the exporter's golden run and
 * the bench page's self-test check that loop, so keep the two in sync. Text encoder, decoder and local transformer
 * run on the chosen backend; the codec always runs on WASM, because on WebGPU (onnxruntime-web 1.31.1, Chrome/Metal)
 * it outputs a steady ~173 Hz buzz even in fp32, while on WASM it matches NeMo exactly.
 */
export class MagpieGenerator {
  private textEncoder: ort.InferenceSession | null = null;
  private decoderStep: ort.InferenceSession | null = null;
  private ltSample: ort.InferenceSession | null = null;
  private codecDecoder: ort.InferenceSession | null = null;
  private readonly forbid: Float32Array;
  private readonly forbidEos: Float32Array;

  constructor(private readonly config: BayanConfig, private readonly voiceContext: Float32Array, private readonly bosEmbedding: Float32Array) {
    const size = config.num_tokens;
    this.forbid = new Float32Array(size);
    for (let token = config.codebook_size; token < size; token++) if (token !== config.audio_eos_id) this.forbid[token] = -Infinity;
    this.forbidEos = this.forbid.slice();
    this.forbidEos[config.audio_eos_id] = -Infinity;
  }

  /** Sessions one after another: parallel WebGPU builds compete for shader compilation. */
  async load(graphs: BayanGraphs, backend: Backend): Promise<void> {
    const onGpu = backend === 'webgpu';
    const options = (extra: Partial<ort.InferenceSession.SessionOptions> = {}): ort.InferenceSession.SessionOptions => ({
      executionProviders: [backend], graphOptimizationLevel: 'all', ...extra,
    });
    // On WebGPU the KV cache and cross K/V stay on the GPU between steps; only what JS reads comes back.
    const decoderOutputs: Record<string, ort.Tensor.DataLocation> = { dec_last: 'gpu-buffer', eos_codes: 'cpu', align: 'cpu' };
    for (let layer = 0; layer < this.config.n_layers; layer++) {
      decoderOutputs[`present_k_${layer}`] = 'gpu-buffer';
      decoderOutputs[`present_v_${layer}`] = 'gpu-buffer';
    }
    this.textEncoder = await ort.InferenceSession.create(graphs.textEncoder, options(onGpu ? { preferredOutputLocation: 'gpu-buffer' } : {}));
    this.decoderStep = await ort.InferenceSession.create(graphs.decoderStep, options(onGpu ? { preferredOutputLocation: decoderOutputs } : {}));
    this.ltSample = await ort.InferenceSession.create(graphs.ltSample, options());
    this.codecDecoder = await ort.InferenceSession.create(graphs.codecDecoder, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }

  /** One take of a sentence: decoder steps until end of speech or maxFrames. */
  async generate(ids: number[], options: TakeOptions): Promise<Take> {
    const textEncoder = this.textEncoder, decoderStep = this.decoderStep, ltSample = this.ltSample;
    if (!textEncoder || !decoderStep || !ltSample) throw new Error('Bayan voice is not loaded yet.');
    const c = this.config, inference = c.inference;
    const C = c.num_codebooks, S = c.frame_stacking, K = C * S, D = c.d_model, layers = c.n_layers;
    const H = c.n_heads, Dh = c.d_head, Tc = c.ctx_len, Tt = ids.length, eos = c.audio_eos_id;
    const steps = Math.floor((options.maxFrames ?? inference.max_decoder_steps) / S);
    const rng = mulberry32(options.seed);

    const encoded = await textEncoder.run({ text_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, Tt]) });
    // Prefill input: [voice context ; BOS frame] for the conditional row, [zeros ; BOS] for the CFG row.
    let x = new Float32Array(2 * (Tc + 1) * D);
    x.set(this.voiceContext, 0);
    x.set(this.bosEmbedding, Tc * D);
    x.set(this.bosEmbedding, (Tc + 1) * D + Tc * D);
    let xDims = [2, Tc + 1, D];
    let positions = BigInt64Array.from({ length: Tc + 1 }, (_, i) => BigInt(i));
    let maskLength = Tc + 2;
    const maskRows = (length: number) => {
      const mask = new Float32Array(2 * length).fill(1);
      mask[0] = 0; // dummy cache slot
      mask[length] = 0;
      for (let i = 1 + c.ctx_valid_len; i < 1 + Tc; i++) mask[i] = 0; // padded voice context (row 0)
      return mask;
    };
    let past: Record<string, ort.Tensor> = {};
    for (let layer = 0; layer < layers; layer++) {
      past[`past_k_${layer}`] = new ort.Tensor('float32', new Float32Array(2 * H * Dh), [2, H, 1, Dh]);
      past[`past_v_${layer}`] = new ort.Tensor('float32', new Float32Array(2 * H * Dh), [2, H, 1, Dh]);
    }
    const cross: Record<string, ort.Tensor> = {};
    for (let layer = 0; layer < layers; layer++) {
      cross[`cross_k_${layer}`] = encoded[`cross_k_${layer}`];
      cross[`cross_v_${layer}`] = encoded[`cross_v_${layer}`];
    }
    let prior: Float32Array = new Float32Array(Tt).fill(1);
    const state = newPriorState();
    const cfgScale = new ort.Tensor('float32', Float32Array.of(inference.cfg_scale), [1]);
    const temperature = new ort.Tensor('float32', Float32Array.of(inference.temperature), [1]);
    const topk = new ort.Tensor('int64', BigInt64Array.of(BigInt(inference.topk)), [1]);
    const allCodes: number[][] = [];
    const attSteps: number[] = [];
    let eosFrame: number | null = null;

    try {
      for (let step = 0; step < steps; step++) {
        const forbid = step * S < inference.min_generated_frames ? this.forbidEos : this.forbid;
        const forbidMask = new ort.Tensor('float32', forbid, [forbid.length]);
        const out = await decoderStep.run({
          x: new ort.Tensor('float32', x, xDims),
          position_ids: new ort.Tensor('int64', positions, [positions.length]),
          attn_mask: new ort.Tensor('float32', maskRows(maskLength), [2, maskLength]),
          prior: new ort.Tensor('float32', prior, [Tt]),
          cfg_scale: cfgScale,
          forbid_mask: forbidMask,
          ...past,
          ...cross,
        });
        if (step > 0) for (const tensor of Object.values(past)) tensor.dispose();
        past = {};
        for (let layer = 0; layer < layers; layer++) {
          past[`past_k_${layer}`] = out[`present_k_${layer}`];
          past[`past_v_${layer}`] = out[`present_v_${layer}`];
        }
        const eosCodes = out.eos_codes.data as BigInt64Array;
        if (inference.apply_attention_prior) prior = nextPrior(out.align.data as Float32Array, state, Tt, inference);
        attSteps.push(state.lastAtt);

        const uniforms = new Float32Array(K);
        for (let k = 0; k < K; k++) uniforms[k] = rng();
        const sampled = await ltSample.run({
          dec_last: out.dec_last, uniforms: new ort.Tensor('float32', uniforms, [K]), temperature, topk, cfg_scale: cfgScale, forbid_mask: forbidMask,
        });
        out.dec_last.dispose();
        const codes = Array.from(sampled.codes.data as BigInt64Array, Number);
        allCodes.push(codes);

        let end: number | null = null;
        for (let s = 0; s < S && end === null; s++) {
          for (let codebook = 0; codebook < C; codebook++) {
            if (codes[s * C + codebook] === eos || Number(eosCodes[s * C + codebook]) === eos) {
              end = s;
              break;
            }
          }
        }
        if (end !== null) {
          eosFrame = step * S + end;
          break;
        }
        const frameEmbedding = sampled.frame_emb.data as Float32Array;
        x = new Float32Array(2 * D);
        x.set(frameEmbedding, 0);
        x.set(frameEmbedding, D);
        xDims = [2, 1, D];
        positions = BigInt64Array.of(BigInt(Tc + 1 + step));
        maskLength += 1;
      }
    }
    finally {
      for (const tensor of Object.values(past)) tensor.dispose();
      for (const tensor of Object.values(encoded)) tensor.dispose();
    }
    const frames = eosFrame ?? allCodes.length * S;
    const codes = Array.from({ length: C }, (_, codebook) => allCodes.flatMap(step => Array.from({ length: S }, (_, s) => step[s * C + codebook])));
    const take = { eosFrame, lastAtt: state.lastAtt, textLength: Tt };
    return { codes, frames, ...take, finished: isFinishedTake(take, inference.apply_attention_prior), steps: allCodes.length, attSteps };
  }

  /** Codes to audio (WASM). */
  async decode(take: Take): Promise<Float32Array> {
    if (!this.codecDecoder) throw new Error('Bayan voice is not loaded yet.');
    const C = this.config.num_codebooks, frames = take.frames;
    const flat = new BigInt64Array(C * frames);
    for (let codebook = 0; codebook < C; codebook++) {
      for (let frame = 0; frame < frames; frame++) flat[codebook * frames + frame] = BigInt(take.codes[codebook][frame]);
    }
    const out = await this.codecDecoder.run({ codes: new ort.Tensor('int64', flat, [1, C, frames]) });
    const audio = (out.audio.data as Float32Array).slice(0, frames * this.config.samples_per_frame);
    out.audio.dispose();
    return audio;
  }

  async dispose(): Promise<void> {
    for (const session of [this.textEncoder, this.decoderStep, this.ltSample, this.codecDecoder]) await session?.release();
    this.textEncoder = this.decoderStep = this.ltSample = this.codecDecoder = null;
  }
}
