/** nabra_config.json, written by nabra-onnx/export/export_nabra_onnx.py next to nabra_fp16.onnx. */
export interface NabraConfig {
  sample_rate: number;
  /** Audio samples per duration frame (600 at 24 kHz = 25 ms). */
  samples_per_frame: number;
  /** Longest phoneme string the model takes in one call (510; ids add a pad token at each end). */
  max_phonemes: number;
  /** Voicepack: `rows` × `dim` float32, row = phoneme-string length − 1. */
  voice: { rows: number; dim: number };
  /** Phoneme → token id, including the trained ع (ʕ → 7) and ح (ħ → 8) slots the published config.json lacks. */
  vocab: Record<string, number>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) > 0;

/** Parses and checks nabra_config.json bytes; throws with the first problem found. */
export function parseNabraConfig(bytes: Uint8Array): NabraConfig {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isObject(value)) throw new Error('nabra_config.json must be an object');
  for (const key of ['sample_rate', 'samples_per_frame', 'max_phonemes'] as const) {
    if (!isCount(value[key])) throw new Error(`nabra_config.json: ${key} must be a positive integer`);
  }
  if (!isObject(value.voice) || !isCount(value.voice.rows) || !isCount(value.voice.dim)) throw new Error('nabra_config.json: voice needs rows and dim');
  if (!isObject(value.vocab) || !Object.values(value.vocab).every(id => Number.isInteger(id))) throw new Error('nabra_config.json: vocab must map phonemes to ids');
  if (value.vocab['ʕ'] !== 7 || value.vocab['ħ'] !== 8) throw new Error('nabra_config.json: vocab lacks the trained ع/ح slots (ʕ 7, ħ 8)');
  return value as unknown as NabraConfig;
}
