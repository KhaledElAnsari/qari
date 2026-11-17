/**
 * The parts of bayan_config.json (written by bayan-onnx/export/export_bayan_onnx.py) the runtime reads.
 * The exporter is the source of truth; this only types it.
 */
export interface BayanTokenizerData {
  tokens: string[];
  offset: number;
  punct: string[];
  pad_with_space: boolean;
  eos_id: number;
}

export interface BayanInference {
  temperature: number;
  topk: number;
  cfg_scale: number;
  max_decoder_steps: number;
  min_generated_frames: number;
  apply_attention_prior: boolean;
  prior_epsilon: number;
  lookahead_window: number;
  sink_move_threshold: number;
  sink_penalty_threshold: number;
  short_text_len: number;
}

export interface BayanConfig {
  sample_rate: number;
  samples_per_frame: number;
  num_codebooks: number;
  frame_stacking: number;
  codebook_size: number;
  num_tokens: number;
  audio_eos_id: number;
  n_layers: number;
  n_heads: number;
  d_head: number;
  d_model: number;
  ctx_len: number;
  ctx_valid_len: number;
  inference: BayanInference;
  tokenizer: BayanTokenizerData;
  golden_tokenizer?: { text: string; ids: number[] }[];
  golden_run?: { text: string; seed: number; steps: number; codes: number[][]; eos_frame: number | null };
}

const NUMBER_FIELDS = ['sample_rate', 'samples_per_frame', 'num_codebooks', 'frame_stacking', 'codebook_size', 'num_tokens',
  'audio_eos_id', 'n_layers', 'n_heads', 'd_head', 'd_model', 'ctx_len', 'ctx_valid_len'] as const;

/** Parses the config bytes; throws a plain Error naming the first missing field (the adapter turns it into voice-unavailable). */
export function parseBayanConfig(bytes: Uint8Array): BayanConfig {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  for (const field of NUMBER_FIELDS) {
    if (typeof value[field] !== 'number') throw new Error(`bayan_config.json: "${field}" must be a number`);
  }
  if (typeof value.inference !== 'object' || value.inference === null) throw new Error('bayan_config.json: "inference" is missing');
  const tokenizer = value.tokenizer as Partial<BayanTokenizerData> | undefined;
  if (!tokenizer || !Array.isArray(tokenizer.tokens) || !Array.isArray(tokenizer.punct)) throw new Error('bayan_config.json: "tokenizer" is missing');
  return value as unknown as BayanConfig;
}
