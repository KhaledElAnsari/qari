/** Arabic script ↔ Buckwalter transliteration, as used by the phonetiser (characters not in the table pass through). */
const ARABIC_TO_BUCKWALTER: Readonly<Record<string, string>> = {
  'ب': 'b', 'ذ': '*', 'ط': 'T', 'م': 'm',
  'ت': 't', 'ر': 'r', 'ظ': 'Z', 'ن': 'n',
  'ث': '^', 'ز': 'z', 'ع': 'E', 'ه': 'h',
  'ج': 'j', 'س': 's', 'غ': 'g', 'ح': 'H',
  'ق': 'q', 'ف': 'f', 'خ': 'x', 'ص': 'S',
  'ش': '$', 'د': 'd', 'ض': 'D', 'ك': 'k',
  'أ': '>', 'ء': '\'', 'ئ': '}', 'ؤ': '&',
  'إ': '<', 'آ': '|', 'ا': 'A', 'ى': 'Y',
  'ة': 'p', 'ي': 'y', 'ل': 'l', 'و': 'w',
  'ً': 'F', 'ٌ': 'N', 'ٍ': 'K', 'َ': 'a',
  'ُ': 'u', 'ِ': 'i', 'ّ': '~', 'ْ': 'o',
};

const BUCKWALTER_TO_ARABIC: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ARABIC_TO_BUCKWALTER).map(([arabic, buckwalter]) => [buckwalter, arabic]),
);

/** Converts Arabic script to Buckwalter letter by letter. */
export function arabicToBuckwalter(text: string): string {
  return Array.from(text, letter => ARABIC_TO_BUCKWALTER[letter] ?? letter).join('');
}

/** Converts Buckwalter back to Arabic script letter by letter. */
export function buckwalterToArabic(text: string): string {
  return Array.from(text, letter => BUCKWALTER_TO_ARABIC[letter] ?? letter).join('');
}
