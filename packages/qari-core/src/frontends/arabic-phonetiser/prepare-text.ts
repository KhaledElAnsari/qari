/** Arabic punctuation the tokenizer doesn't know, mapped to the four marks it does (. , ? !). */
const PUNCTUATION_FOR_TOKENIZER: Readonly<Record<string, string>> = {
  '،': ',',
  '؛': ',',
  '؟': '?',
  ':': ',',
};

// The phonetiser reads ASCII as Buckwalter transliteration, so a pasted "MIT" would be spoken as ط.
// Keep only the Arabic block (letters, diacritics, Arabic-Indic digits), whitespace and the four marks the model knows.
const OUTSIDE_TOKENIZER_ALPHABET = /[^\u0600-\u06FF\s.,?!]/g;

/**
 * Prepares Arabic text for the phonetiser: maps Arabic punctuation, drops everything outside the Arabic block
 * (Latin letters, ASCII symbols, presentation forms), drops tatweel and collapses spaces.
 * Added in qari (not in nipponjo's original), so punctuation becomes pauses and Latin text stays silent.
 */
export function prepareArabicText(text: string): string {
  return Array.from(text, letter => PUNCTUATION_FOR_TOKENIZER[letter] ?? letter)
    .join('')
    .replace(OUTSIDE_TOKENIZER_ALPHABET, '')
    .replaceAll('ـ', '')
    .replace(/\s+/g, ' ')
    .trim();
}
