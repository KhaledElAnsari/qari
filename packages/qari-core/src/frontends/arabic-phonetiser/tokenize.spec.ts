import golden from './fixtures/phonetiser-golden.json';
import { arabicToBuckwalter, buckwalterToArabic } from './buckwalter';
import { processUtterance } from './phonetise';
import { prepareArabicText } from './prepare-text';
import { isSpokenToken } from './symbols';
import { arabicToTokens, phonemesToTokens, tokensToIds } from './tokenize';

interface GoldenCase {
  text: string;
  buckwalter: string;
  phonemes: string;
  tokens: string[];
  ids: number[];
}

const CASES = (golden as { cases: GoldenCase[] }).cases;

describe('arabic-phonetiser port (Q1)', () => {
  it('has golden cases to compare against', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  describe.each(CASES)('$text', (golden) => {
    it('transliterates to the same Buckwalter as the Python original', () => {
      expect(arabicToBuckwalter(golden.text)).toBe(golden.buckwalter);
    });

    it('produces the same phonemes as the Python original', () => {
      expect(processUtterance(golden.buckwalter)).toBe(golden.phonemes);
    });

    it('produces the same tokens and ids as the Python original', () => {
      expect(phonemesToTokens(golden.phonemes)).toEqual(golden.tokens);
      expect(arabicToTokens(golden.text)).toEqual(golden.tokens);
      expect(tokensToIds(golden.tokens).ids).toEqual(golden.ids);
    });
  });

  it('round-trips Buckwalter back to Arabic', () => {
    expect(buckwalterToArabic(arabicToBuckwalter('اَلسَّلامُ عَلَيكُم'))).toBe('اَلسَّلامُ عَلَيكُم');
  });

  it('drops and reports tokens the model does not know', () => {
    expect(tokensToIds(['b', 'zz9', '_eos_'])).toEqual({ ids: [10, 1], unknownTokens: ['zz9'] });
  });
});

describe('spoken tokens (nothing-to-read check)', () => {
  it('finds sound in Arabic letters and none in digits, Latin letters or punctuation alone', () => {
    expect(arabicToTokens(prepareArabicText('سَلَامٌ')).some(isSpokenToken)).toBe(true);
    expect(arabicToTokens(prepareArabicText('١٩٤٨ MIT ، ؟')).some(isSpokenToken)).toBe(false);
  });

  it('keeps Latin letters and ASCII symbols from being read as transliteration', () => {
    expect(prepareArabicText('عَامَ MIT* $x')).toBe('عَامَ');
    expect(prepareArabicText('قَالَ: نَعَمْ؟')).toBe('قَالَ, نَعَمْ?');
  });
});
