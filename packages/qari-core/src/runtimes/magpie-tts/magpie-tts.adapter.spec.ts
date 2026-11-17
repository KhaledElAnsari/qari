import { QariError } from '../../errors/qari-error';
import type { VoiceConfig } from '../../voice/voice-config';
import golden from './fixtures/tokenizer-golden.json';
import type { Take } from './generator';
import { MagpieGenerator } from './generator';
import { MagpieTtsAdapter, MAX_TAKES } from './magpie-tts.adapter';

// The real generator needs onnxruntime and the model files; these tests drive the adapter's own logic with a fake.
jest.mock('./generator', () => ({ MagpieGenerator: jest.fn() }));

const config = {
  sample_rate: 22050, samples_per_frame: 1024, num_codebooks: 8, frame_stacking: 2, codebook_size: 2016, num_tokens: 2024,
  audio_eos_id: 2017, n_layers: 12, n_heads: 12, d_head: 64, d_model: 768, ctx_len: 2, ctx_valid_len: 2,
  inference: { temperature: 0.6, topk: 80, cfg_scale: 2.5, max_decoder_steps: 800, min_generated_frames: 4, apply_attention_prior: true,
    prior_epsilon: 0.1, lookahead_window: 5, sink_move_threshold: 8, sink_penalty_threshold: 10, short_text_len: 5 },
  tokenizer: golden.tokenizer,
};
const voice = { id: 'bayan-test', sampleRate: 22050, runtime: 'magpie-tts', timings: 'alignment' } as VoiceConfig;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const models = {
  model: new Uint8Array(1),
  vocoder: new Uint8Array(1),
  files: { config: bytes(config), textEncoder: new Uint8Array(1), ltSample: new Uint8Array(1), voiceContext: new Uint8Array(8), bosEmbedding: new Uint8Array(4) },
};
// Attention moving through 'إِنَّ الْعِلْمَ نُورٌ.' (word letters at 1-5, 7-15, 17-21; spaces at 6 and 16).
const take = (finished: boolean): Take => ({ codes: [], frames: 20, eosFrame: 20, lastAtt: finished ? 55 : 30, textLength: 59, finished, steps: 10, attSteps: [6, 8, 12, 15, 17, 19, 21, 21, 22, 22] });
const AUDIO_SAMPLES = 20 * 1024;

async function adapterWith(takes: boolean[]) {
  const generate = jest.fn();
  for (const finished of takes) generate.mockResolvedValueOnce(take(finished));
  const decode = jest.fn(async () => new Float32Array(AUDIO_SAMPLES).fill(0.1));
  (MagpieGenerator as unknown as jest.Mock).mockImplementation(() => ({ load: jest.fn(), generate, decode, dispose: jest.fn() }));
  const warnings: string[] = [];
  const adapter = new MagpieTtsAdapter({ onWarning: message => warnings.push(message) });
  await adapter.load(voice, models, 'webgpu');
  return { adapter, generate, decode, warnings };
}

describe('Bayan adapter (magpie-tts)', () => {
  it('fails with reading-failed (press play to try again) when every take of a sentence ends early', async () => {
    const { adapter, generate, decode } = await adapterWith([false, false, false]);
    const failure = adapter.synthesize('إِنَّ الْعِلْمَ نُورٌ.', 1);
    await expect(failure).rejects.toBeInstanceOf(QariError);
    await expect(failure).rejects.toMatchObject({ code: 'reading-failed', suggestsDefaultMode: false });
    expect(generate).toHaveBeenCalledTimes(MAX_TAKES);
    expect(decode).not.toHaveBeenCalled();
  });

  it('uses the first finished take and notes the retry for developers', async () => {
    const { adapter, generate, decode, warnings } = await adapterWith([false, true]);
    const result = await adapter.synthesize('إِنَّ الْعِلْمَ نُورٌ.', 1);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(result.sampleRate).toBe(22050);
    expect(warnings).toEqual(['Sentence needed 2 takes (earlier takes ended early).']);
  });

  it('reads each sentence as its own take, with a pause between them', async () => {
    const { adapter, generate } = await adapterWith([true, true]);
    const result = await adapter.synthesize('إِنَّ الْعِلْمَ نُورٌ. وَالْكِتَابُ خَيْرُ جَلِيسٍ.', 1);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.pcm.length).toBe(2 * AUDIO_SAMPLES + Math.round(0.2 * 22050));
  });

  it('times every displayed word from the attention, the second sentence after the first and the pause', async () => {
    const { adapter } = await adapterWith([true, true]);
    const result = await adapter.synthesize('إِنَّ الْعِلْمَ نُورٌ. إِنَّ الْعِلْمَ نُورٌ.', 1);
    const words = result.timings?.displayWords ?? [];
    expect(words.map(word => word.text)).toEqual(['إِنَّ', 'الْعِلْمَ', 'نُورٌ.', 'إِنَّ', 'الْعِلْمَ', 'نُورٌ.']);
    expect(words[0].start).toBe(0);
    words.slice(1).forEach((word, i) => expect(word.start).toBeGreaterThanOrEqual(words[i].start));
    expect(words[3].start).toBeGreaterThanOrEqual(Math.round(((AUDIO_SAMPLES + Math.round(0.2 * 22050)) / 22050) * 1000) / 1000);
    expect(words.slice(0, 3).every(word => word.end > word.start)).toBe(true);
  });

  it('keeps a number\'s spoken words under its displayed word', async () => {
    const { adapter } = await adapterWith([true]);
    const result = await adapter.synthesize('عَامَ 1950.', 1);
    expect(result.timings?.displayWords.map(word => word.text)).toEqual(['عَامَ', '1950.']);
    expect(result.timings?.displayWords[1].spokenIndexes.length).toBeGreaterThan(1);
  });

  it('says there is nothing to read when the text has no Arabic letters', async () => {
    const { adapter, generate } = await adapterWith([]);
    await expect(adapter.synthesize('English only.', 1)).rejects.toMatchObject({ code: 'nothing-to-read' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('warns once that it has no speed control', async () => {
    const { adapter, warnings } = await adapterWith([true, true]);
    await adapter.synthesize('نُورٌ', 1.5);
    await adapter.synthesize('نُورٌ', 1.5);
    expect(warnings).toEqual(['This voice has no speed control; it reads at its normal speed.']);
  });

  it('refuses a voice config that lacks a Bayan file', async () => {
    const adapter = new MagpieTtsAdapter({ onWarning: () => undefined });
    const files: Record<string, Uint8Array> = { ...models.files };
    delete files.ltSample;
    await expect(adapter.load(voice, { ...models, files }, 'webgpu')).rejects.toMatchObject({ code: 'voice-unavailable' });
  });
});
