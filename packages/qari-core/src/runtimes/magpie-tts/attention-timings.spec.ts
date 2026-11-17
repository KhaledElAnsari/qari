import { attentionWordSpans } from './attention-timings';
import { NO_WORD, PUNCTUATION } from './tokenizer';

// 'أ بب، ج': pad, word 0 (1), space, word 1 (3-4), comma, space, word 2 (7), pad, end.
const tokenWords = [NO_WORD, 0, NO_WORD, 1, 1, PUNCTUATION, NO_WORD, 2, NO_WORD, NO_WORD];
const base = { tokenWords, wordCount: 3, frameStacking: 2, samplesPerFrame: 1, sampleRate: 1 };

describe('Bayan attention word timings', () => {
  it('shifts by the lead, hands over at a plain space, pauses at punctuation, ends where the sound fades', () => {
    const audio = Float32Array.from({ length: 16 }, (_, i) => (i < 14 ? 0.5 : 0)); // last 2 frames silent
    // attention per step (2 frames each): space, word 1, word 1, comma, space, word 2, word 2, word 2
    const spans = attentionWordSpans({ ...base, attSteps: [2, 3, 4, 5, 6, 7, 7, 7], frames: 16, audio, leadFrames: 2 });
    expect(spans).toEqual([
      { start: 0, end: 4 }, // first word: from the start until the attention (2 frames late) reaches word 1
      { start: 4, end: 8 }, // word 1: until the comma, so the comma pause belongs to no word
      { start: 12, end: 14 }, // word 2: ends where the sound fades, not at the last frame
    ]);
  });

  it('gives a word the voice never reaches zero length at the end of the speech', () => {
    const audio = new Float32Array(8).fill(0.5);
    const spans = attentionWordSpans({ ...base, attSteps: [1, 1, 3, 4], frames: 8, audio, leadFrames: 0 });
    expect(spans[2]).toEqual({ start: 8, end: 8 });
  });
});
