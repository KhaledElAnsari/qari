import femaleSound from '../../../../voices/female-sound.json';
import maleSound from '../../../../voices/male-sound.json';
import { modelKey, parseVoiceConfig, resolveVoiceUrls } from './voice-config';
import type { VoiceConfig } from './voice-config';

describe('voice config (Q1, PRD 5.3)', () => {
  it('accepts the example Male sound and Female sound configs', () => {
    expect(parseVoiceConfig(maleSound)).toMatchObject({ ok: true, voice: { id: 'nipponjo-male', speaker: 1, isDefault: true } });
    expect(parseVoiceConfig(femaleSound)).toMatchObject({ ok: true, voice: { id: 'nipponjo-female', speaker: 3 } });
  });

  it('makes Female sound a config change: same model files, different speaker', () => {
    expect(modelKey(maleSound as VoiceConfig)).toBe(modelKey(femaleSound as VoiceConfig));
  });

  it('reports the first problem in an invalid config', () => {
    expect(parseVoiceConfig({ ...maleSound, model: { url: '', version: '1' } })).toEqual({ ok: false, reason: 'model.url must be a non-empty string' });
    expect(parseVoiceConfig({ ...maleSound, durationOutput: undefined })).toEqual({ ok: false, reason: 'durationOutput is required when timings is native' });
    expect(parseVoiceConfig({ ...maleSound, timings: 'aligned' })).toEqual({ ok: false, reason: 'timings must be one of native, alignment, none' });
    expect(parseVoiceConfig(null)).toEqual({ ok: false, reason: 'voice config must be an object' });
  });

  it('resolves relative model URLs against the config URL', () => {
    const voice = { ...maleSound, model: { url: 'models/mixer128.onnx', version: '1' } } as VoiceConfig;
    expect(resolveVoiceUrls(voice, 'https://site.example/voices/male.json').model.url).toBe('https://site.example/voices/models/mixer128.onnx');
  });
});
