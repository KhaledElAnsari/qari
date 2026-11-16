/** Token inventory of nipponjo's Arabic TTS models; a token's id is its position in SYMBOLS. */
export const PADDING_TOKEN = '_pad_';
export const EOS_TOKEN = '_eos_';
export const DOUBLING_TOKEN = '_dbl_';
export const SEPARATOR_TOKEN = '_+_';

export const SYMBOLS = [
  // special tokens
  PADDING_TOKEN, EOS_TOKEN, '_sil_', DOUBLING_TOKEN, SEPARATOR_TOKEN,
  // punctuation
  '.', ',', '?', '!',
  // consonants (Buckwalter-style phoneme names)
  '<', 'b', 't', '^', 'j', 'H', 'x', 'd', '*', 'r', 'z', 's', '$', 'S', 'D', 'T', 'Z', 'E', 'g', 'f', 'q', 'k', 'l', 'm', 'n', 'h', 'w', 'y',
  'v', // /v/ in loanwords such as فيديو
  // vowels: short, then long
  'a', 'u', 'i', 'aa', 'uu', 'ii',
] as const;

export type ModelToken = (typeof SYMBOLS)[number];

const SYMBOL_IDS = new Map<string, number>(SYMBOLS.map((symbol, id) => [symbol, id]));

/** Returns the model id of a token, or undefined when the model has no such token. */
export function symbolId(token: string): number | undefined {
  return SYMBOL_IDS.get(token);
}

const SILENT_TOKENS: ReadonlySet<string> = new Set([PADDING_TOKEN, EOS_TOKEN, '_sil_', DOUBLING_TOKEN, SEPARATOR_TOKEN, '.', ',', '?', '!']);

/** True for tokens that make a sound (consonants and vowels), false for pauses, separators and punctuation. */
export function isSpokenToken(token: string): boolean {
  return symbolId(token) !== undefined && !SILENT_TOKENS.has(token);
}
