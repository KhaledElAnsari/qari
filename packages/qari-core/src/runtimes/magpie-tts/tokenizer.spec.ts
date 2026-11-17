import golden from './fixtures/tokenizer-golden.json';
import { BayanTokenizer } from './tokenizer';

describe('Bayan tokenizer (NeMo arabic_MSA_chartokenizer)', () => {
  const tokenizer = new BayanTokenizer(golden.tokenizer);

  it.each(golden.golden.map(entry => [entry.text, entry.ids] as const))('gives NeMo\'s ids for %j', (text, ids) => {
    expect(tokenizer.encode(text)).toEqual(ids);
  });

  it('knows when there is nothing to say', () => {
    expect(tokenizer.hasSpeech('مرحبا')).toBe(true);
    expect(tokenizer.hasSpeech('English only, 123 . ؟')).toBe(false);
    expect(tokenizer.hasSpeech('   ')).toBe(false);
  });
});
