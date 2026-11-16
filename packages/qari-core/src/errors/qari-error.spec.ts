import { MODE_LABELS, QARI_ERROR_CODES, QariError, parseErrorCode, toQariError } from './qari-error';

// Words a listener shouldn't need to know (decision 2026-11-16). Checked in both languages' messages.
const TECHNICAL_WORDS = /webgpu|wasm|gpu|cpu|onnx|opfs|http|worker|webassembly|backend|model|session|shader|cache|sha|null|undefined|exception|stack|\bcode\b|خادم|معالج|ذاكرة/i;

describe('friendly errors (decision 2026-11-16)', () => {
  it('gives every code an Arabic and an English message', () => {
    for (const code of QARI_ERROR_CODES) {
      const { text } = new QariError(code);
      expect(text.ar).toMatch(/[؀-ۿ]/);
      expect(text.en).toMatch(/^[A-Z].+\.$/);
    }
  });

  it('keeps technical words out of every message, in both languages', () => {
    for (const code of QARI_ERROR_CODES) {
      const { text } = new QariError(code, 'WebGPU device lost (onnx session)');
      expect(text.ar).not.toMatch(TECHNICAL_WORDS);
      expect(text.en).not.toMatch(TECHNICAL_WORDS);
    }
  });

  it('keeps the technical cause in detail, not in the message', () => {
    const error = new QariError('voice-download-failed', 'Model https://x/m.onnx returned HTTP 503.');
    expect(error.message).toBe(error.text.en);
    expect(error.message).not.toContain('503');
    expect(error.detail).toContain('HTTP 503');
  });

  it('uses the mode names from MODE_LABELS in accelerated-mode messages', () => {
    const { text } = new QariError('accelerated-mode-failed');
    expect(text.ar).toContain(MODE_LABELS.webgpu.ar);
    expect(text.ar).toContain(MODE_LABELS.wasm.ar);
    expect(text.en).toContain(MODE_LABELS.wasm.en);
  });

  it('offers default mode only for accelerated-mode problems, and retry only where trying again can help', () => {
    const suggesting = QARI_ERROR_CODES.filter(code => new QariError(code).suggestsDefaultMode);
    expect(suggesting).toEqual(['accelerated-mode-unavailable', 'accelerated-mode-failed']);
    expect(new QariError('accelerated-mode-unavailable').canRetry).toBe(false);
    expect(new QariError('accelerated-mode-failed').canRetry).toBe(true);
    expect(new QariError('voice-download-failed').canRetry).toBe(true);
    expect(new QariError('browser-unsupported').canRetry).toBe(false);
  });

  it('wraps unknown failures with a fallback code and keeps known ones', () => {
    const known = new QariError('nothing-to-read');
    expect(toQariError(known, 'unexpected')).toBe(known);
    expect(toQariError(new Error('boom'), 'reading-failed')).toMatchObject({ code: 'reading-failed', detail: 'boom' });
    expect(parseErrorCode('voice-unavailable')).toBe('voice-unavailable');
    expect(parseErrorCode('made-up')).toBe('unexpected');
  });
});
