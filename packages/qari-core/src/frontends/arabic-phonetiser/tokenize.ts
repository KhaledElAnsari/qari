import { arabicToBuckwalter } from './buckwalter';
import { processUtterance } from './phonetise';
import { DOUBLING_TOKEN, EOS_TOKEN, SEPARATOR_TOKEN, symbolId } from './symbols';

const PHONEME_VOWELS = new Set(['aa', 'AA', 'uu0', 'uu1', 'UU0', 'UU1', 'ii0', 'ii1', 'II0', 'II1', 'a', 'A', 'u0', 'u1', 'U0', 'U1', 'i0', 'i1', 'I0', 'I1']);

/** Collapses the phonetiser's vowel variants (emphatic, final) to the six model vowels. */
const VOWEL_TOKENS: Readonly<Record<string, string>> = {
  'aa': 'aa', 'AA': 'aa',
  'uu0': 'uu', 'uu1': 'uu', 'UU0': 'uu', 'UU1': 'uu',
  'ii0': 'ii', 'ii1': 'ii', 'II0': 'ii', 'II1': 'ii',
  'a': 'a', 'A': 'a',
  'u0': 'u', 'u1': 'u', 'U0': 'u', 'U1': 'u',
  'i0': 'i', 'i1': 'i', 'I0': 'i', 'I1': 'i',
};

/** Turns a phoneme string into model tokens: doubled consonants get a doubling token, words a separator, then end-of-sequence. */
export function phonemesToTokens(phonemes: string): string[] {
  const tokens = phonemes.replaceAll('sil', '').replaceAll('+', SEPARATOR_TOKEN).split(/\s+/).filter(token => token !== '');
  // The loop also visits the doubling tokens it inserts, like the original.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length === 2 && !PHONEME_VOWELS.has(token) && token[0] === token[1]) {
      tokens[i] = token[0];
      tokens.splice(i + 1, 0, DOUBLING_TOKEN);
    }
    if (PHONEME_VOWELS.has(tokens[i])) tokens[i] = VOWEL_TOKENS[tokens[i]];
  }
  tokens.push(SEPARATOR_TOKEN, EOS_TOKEN);
  return tokens;
}

/** Result of mapping tokens to model ids; unknown tokens are dropped and listed. */
export interface TokenIds {
  ids: number[];
  unknownTokens: string[];
}

/** Maps tokens to model ids. */
export function tokensToIds(tokens: string[]): TokenIds {
  const ids: number[] = [];
  const unknownTokens: string[] = [];
  for (const token of tokens) {
    const id = symbolId(token);
    if (id === undefined) unknownTokens.push(token);
    else ids.push(id);
  }
  return { ids, unknownTokens };
}

/** Arabic script (diacritized for best results) → model tokens. */
export function arabicToTokens(text: string): string[] {
  return phonemesToTokens(processUtterance(arabicToBuckwalter(text)));
}
