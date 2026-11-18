import { QariError } from '../../errors/qari-error';
import type { VoiceConfig } from '../../voice/voice-config';
import { createSession } from '../ort-session';
import { loadEspeak } from './espeak';
import { KokoroAdapter } from './kokoro.adapter';

// The real session needs onnxruntime and the model; espeak needs its WASM. These tests drive the adapter with fakes:
// espeak is a rule-based stand-in (g2p.spec.ts checks the real pipeline), and the model gives every token 4 frames.
jest.mock('../ort-session', () => ({ createSession: jest.fn() }));
jest.mock('./espeak', () => ({ loadEspeak: jest.fn() }));
jest.mock('onnxruntime-web/webgpu', () => ({
  Tensor: class {
    constructor(public type: string, public data: unknown, public dims: number[]) {}
    dispose() {}
  },
}));

const SAMPLES_PER_FRAME = 600;
const FRAMES_PER_TOKEN = 4;
const config = { sample_rate: 24000, samples_per_frame: SAMPLES_PER_FRAME, max_phonemes: 510, voice: { rows: 510, dim: 256 }, vocab: {} as Record<string, number> };
config.vocab = { ' ': 16, 'a': 43, 'b': 44, 'ɑ': 69, 'ʕ': 7, 'ħ': 8 };

const voice = { id: 'nabra-test', sampleRate: 24000, runtime: 'kokoro', timings: 'native', durationOutput: 'durations' } as VoiceConfig;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const models = {
  model: new Uint8Array(1),
  files: { config: bytes(config), voice: new Uint8Array(510 * 256 * 4), espeak: new Uint8Array(1) },
};

/** A rule-based espeak stand-in: ع → ʕ, ح → ħ, every other letter → b, each followed by a; words stay words. */
const espeak = {
  phonemize: (text: string) => text.split(' ').map(word => [...word].map((char) => {
    if (char === '\u0639') return 'ʕa';
    if (char === '\u062D') return 'ħa';
    return /[\u0621-\u064A]/.test(char) ? 'ba' : '';
  }).join('')).join(' '),
};

function fakeSession(waveforms: ((length: number) => Float32Array)[] = []) {
  const run = jest.fn(async (feeds: Record<'input_ids' | 'style' | 'speed', { dims: number[]; data: ArrayLike<number | bigint> }>) => {
    const tokens = feeds.input_ids.dims[1];
    const length = tokens * FRAMES_PER_TOKEN * SAMPLES_PER_FRAME;
    const make = waveforms.shift() ?? (n => new Float32Array(n).map((_, i) => 0.3 * Math.sin(i / 3)));
    return {
      waveform: { data: make(length), dispose: jest.fn() },
      durations: { data: BigInt64Array.from({ length: tokens }, () => BigInt(FRAMES_PER_TOKEN)), dispose: jest.fn() },
    };
  });
  return { run, release: jest.fn() };
}

async function adapterWith(session = fakeSession()) {
  (createSession as jest.Mock).mockResolvedValue(session);
  (loadEspeak as jest.Mock).mockResolvedValue(espeak);
  const warnings: string[] = [];
  const adapter = new KokoroAdapter({ onWarning: message => warnings.push(message) });
  await adapter.load(voice, models, 'webgpu');
  return { adapter, session, warnings };
}

describe('Nabra adapter (kokoro)', () => {
  it('reads a sentence with word timings from the durations', async () => {
    const { adapter, session } = await adapterWith();
    const result = await adapter.synthesize('هَلْ تَعْلَمُ؟ نَعَمْ! أَعْلَمُ...', 0.9);
    expect(result.sampleRate).toBe(24000);
    expect(session.run).toHaveBeenCalledTimes(3); // «هَلْ تَعْلَمُ؟», «نَعَمْ!», «أَعْلَمُ...» (one sentence per call)
    const words = result.timings?.displayWords ?? [];
    expect(words.map(word => word.text)).toEqual(['هَلْ', 'تَعْلَمُ؟', 'نَعَمْ!', 'أَعْلَمُ...']);
    for (const word of words) expect(word.end).toBeGreaterThan(word.start);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].end);
    // The second sentence starts after the first one's audio plus the 0.2 s gap.
    expect(words[2].start).toBeGreaterThan(words[1].end + 0.2);
    expect(result.timings?.duration).toBeCloseTo(result.pcm.length / 24000, 2);
  });

  it('passes the pace as the model\'s speed', async () => {
    const { adapter, session } = await adapterWith();
    await adapter.synthesize('عَلِيٌّ حَسَنٌ.', 0.9);
    expect(Number(session.run.mock.calls[0][0].speed.data[0])).toBeCloseTo(0.9);
  });

  it('keeps ع and ح as their trained tokens', async () => {
    const { adapter, session } = await adapterWith();
    await adapter.synthesize('عَلِيٌّ حَسَنٌ.', 1);
    const ids = Array.from(session.run.mock.calls[0][0].input_ids.data as BigInt64Array, Number);
    expect(ids).toContain(7);
    expect(ids).toContain(8);
  });

  it('makes a take with NaN again, then fails instead of playing silence', async () => {
    const nan = (n: number) => new Float32Array(n).fill(Number.NaN);
    const retried = await adapterWith(fakeSession([nan]));
    await retried.adapter.synthesize('عَلِيٌّ حَسَنٌ.', 1);
    expect(retried.session.run).toHaveBeenCalledTimes(2);
    expect(retried.warnings[0]).toMatch(/invalid take/);

    const failing = await adapterWith(fakeSession([nan, nan]));
    await expect(failing.adapter.synthesize('عَلِيٌّ حَسَنٌ.', 1)).rejects.toMatchObject({ code: 'reading-failed' });
  });

  it('says there is nothing to read when the text has no Arabic letters', async () => {
    const { adapter } = await adapterWith();
    await expect(adapter.synthesize('Google MIT', 1)).rejects.toBeInstanceOf(QariError);
    await expect(adapter.synthesize('Google MIT', 1)).rejects.toMatchObject({ code: 'nothing-to-read' });
  });

  it('gives a Latin word a zero-length time where the reading is', async () => {
    const { adapter } = await adapterWith();
    const result = await adapter.synthesize('يَعْمَلُ فِي شَرِكَةِ Google مُنْذُ سَنَوَاتٍ.', 1);
    const google = result.timings?.displayWords.find(word => word.text === 'Google');
    expect(google?.end).toBe(google?.start);
  });

  it('refuses a voice whose files are missing or don\'t match', async () => {
    (loadEspeak as jest.Mock).mockResolvedValue(espeak);
    const adapter = new KokoroAdapter({ onWarning: () => {} });
    await expect(adapter.load(voice, { model: new Uint8Array(1), files: { config: bytes(config) } }, 'wasm')).rejects.toMatchObject({ code: 'voice-unavailable' });
    await expect(adapter.load({ ...voice, sampleRate: 22050 }, models, 'wasm')).rejects.toMatchObject({ code: 'voice-unavailable' });
    const noAinHaa = { ...config, vocab: { a: 1 } };
    await expect(adapter.load(voice, { ...models, files: { ...models.files, config: bytes(noAinHaa) } }, 'wasm')).rejects.toMatchObject({ code: 'voice-unavailable' });
  });
});
