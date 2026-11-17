/**
 * Arabic numbers as fully diacritized words, for the voice to read. Ported and extended from Maqroo2's ar_numbers.py.
 *
 * Read in pause form: no tanween on any number word (ثَلَاثَة, أَلْف وَتِسْعِمِئَة; أَلْفا keeps its alif, read "alfā").
 * Case: genitive (مجرور), the most common case for numbers in running text ("عامِ ١٩٤٨", "صفحةِ ٢٣"). The counted noun
 * is assumed masculine (عام، يوم، كتاب), so 3–10 take the feminine form. A starting point, not a grammar engine:
 * "وله ٣ أبناء" is read ثَلَاثَةٍ, where the grammar wants ثَلَاثَةُ.
 */

const ONES = ['', 'وَاحِدٍ', 'اِثْنَيْنِ', 'ثَلَاثَةٍ', 'أَرْبَعَةٍ', 'خَمْسَةٍ', 'سِتَّةٍ', 'سَبْعَةٍ', 'ثَمَانِيَةٍ', 'تِسْعَةٍ'];
const TEENS = ['عَشَرَةٍ', 'أَحَدَ عَشَرَ', 'اِثْنَيْ عَشَرَ', 'ثَلَاثَةَ عَشَرَ', 'أَرْبَعَةَ عَشَرَ', 'خَمْسَةَ عَشَرَ', 'سِتَّةَ عَشَرَ', 'سَبْعَةَ عَشَرَ', 'ثَمَانِيَةَ عَشَرَ', 'تِسْعَةَ عَشَرَ'];
const TENS = ['', '', 'عِشْرِينَ', 'ثَلَاثِينَ', 'أَرْبَعِينَ', 'خَمْسِينَ', 'سِتِّينَ', 'سَبْعِينَ', 'ثَمَانِينَ', 'تِسْعِينَ'];
const HUNDREDS = ['', 'مِئَةٍ', 'مِئَتَيْنِ', 'ثَلَاثِمِئَةٍ', 'أَرْبَعِمِئَةٍ', 'خَمْسِمِئَةٍ', 'سِتِّمِئَةٍ', 'سَبْعِمِئَةٍ', 'ثَمَانِمِئَةٍ', 'تِسْعِمِئَةٍ'];
/** Digits read one by one (phone numbers, codes): plain names, no case ending. */
const DIGIT_NAMES = ['صِفْر', 'وَاحِد', 'اِثْنَان', 'ثَلَاثَة', 'أَرْبَعَة', 'خَمْسَة', 'سِتَّة', 'سَبْعَة', 'ثَمَانِيَة', 'تِسْعَة'];

/** A scale word in its forms: one, two, 3–10 (plural genitive), 11–99 (singular accusative). */
interface Scale {
  value: number;
  one: string;
  two: string;
  plural: string;
  accusative: string;
}
const SCALES: readonly Scale[] = [
  { value: 1e9, one: 'مِلْيَارٍ', two: 'مِلْيَارَيْنِ', plural: 'مِلْيَارَاتٍ', accusative: 'مِلْيَارًا' },
  { value: 1e6, one: 'مِلْيُونٍ', two: 'مِلْيُونَيْنِ', plural: 'مَلَايِينَ', accusative: 'مِلْيُونًا' },
  { value: 1e3, one: 'أَلْفٍ', two: 'أَلْفَيْنِ', plural: 'آلَافٍ', accusative: 'أَلْفًا' },
];
/** The largest number read as a number; longer ones are read digit by digit. */
export const MAX_NUMBER = 999_999_999_999;

/** Construct state (مضاف): the last word's kasratan becomes a kasra, as before آلاف or ألف. */
const construct = (phrase: string) => phrase.replace(/ٍ$/u, 'ِ');

function below100(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const ones = n % 10;
  const tens = TENS[Math.floor(n / 10)];
  return ones === 0 ? tens : `${ONES[ones]} وَ${tens}`;
}

function below1000(n: number): string {
  const parts = [HUNDREDS[Math.floor(n / 100)], below100(n % 100)].filter(Boolean);
  return parts.join(' وَ');
}

/** A count (1–999) of a scale word: أَلْفٍ، أَلْفَيْنِ، ثَلَاثَةِ آلَافٍ، أَحَدَ عَشَرَ أَلْفًا، مِئَةِ أَلْفٍ. */
function scaled(count: number, scale: Scale): string {
  if (count === 1) return scale.one;
  if (count === 2) return scale.two;
  if (count <= 10) return `${construct(count === 10 ? 'عَشَرَةٍ' : ONES[count])} ${scale.plural}`;
  const words = below1000(count);
  const lastTwo = count % 100;
  if (lastTwo >= 11) return `${words} ${scale.accusative}`;
  if (lastTwo >= 3) return `${construct(words)} ${scale.plural}`;
  return `${construct(words)} ${scale.one}`;
}

/** Tanween marks: fathatan, dammatan, kasratan. */
const TANWEEN = /[\u064B-\u064D]/gu;

/** A whole number (0 … MAX_NUMBER) as genitive words, in pause form (no tanween). */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > MAX_NUMBER) throw new RangeError(`Can't read ${n} as words.`);
  return withTanween(n).replace(TANWEEN, '');
}

/** The words with their tanween; construct state (ثَلَاثَةِ آلَافٍ) is worked out on these forms. */
function withTanween(n: number): string {
  if (n === 0) return 'صِفْرٍ';
  const parts: string[] = [];
  let rest = n;
  for (const scale of SCALES) {
    const count = Math.floor(rest / scale.value);
    rest %= scale.value;
    if (count > 0) parts.push(scaled(count, scale));
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(' وَ');
}

/** Digits read one by one: "0501" → صِفْر خَمْسَة صِفْر وَاحِد. */
export function readDigits(digits: string): string {
  return Array.from(digits, digit => DIGIT_NAMES[Number(digit)]).join(' ');
}

const ARABIC_INDIC = /[٠-٩]/g;
const PERSIAN = /[۰-۹]/g;
/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits as Western digits. */
export const toWesternDigits = (text: string) => text
  .replace(ARABIC_INDIC, digit => String(digit.charCodeAt(0) - 0x0660))
  .replace(PERSIAN, digit => String(digit.charCodeAt(0) - 0x06F0));

/** A number inside a word: digits, optional thousands separators, optional decimal part, optional percent sign. */
const NUMBER = /(\d+(?:[,٬]\d{3})+|\d+)(?:[.٫](\d+))?\s?([%٪])?/g;

/** Words for one number as written ("1,500", "3.5", "50%", "0501234567"). */
function numberPhrase(whole: string, fraction: string | undefined, percent: string | undefined): string {
  const digits = whole.replace(/[,٬]/g, '');
  // Codes and phone numbers: a leading zero, or too long to be a quantity.
  const asDigits = (digits.length > 1 && digits.startsWith('0')) || Number(digits) > MAX_NUMBER;
  let words = asDigits ? readDigits(digits) : numberToWords(Number(digits));
  if (fraction !== undefined) {
    const fractionWords = fraction.startsWith('0') || Number(fraction) > MAX_NUMBER ? readDigits(fraction) : numberToWords(Number(fraction));
    words += ` فَاصِلَة ${fractionWords}`;
  }
  if (percent) words += ' بِالمِئَةِ';
  return words;
}

/**
 * The spoken words for one displayed word: numbers become words, everything else stays as it is. A prefix written onto
 * a number stays on its first word (وَ12 → وَاثْنَيْ عَشَرَ, with the hamzat al-wasl's kasra dropped after the prefix),
 * and punctuation after it stays on its last word, so pauses still fall in the right place.
 */
export function normalizeNumbersInWord(word: string): string[] {
  const western = toWesternDigits(word);
  if (!/\d/.test(western)) return [word];
  const spoken = western.replace(NUMBER, (match, whole: string, fraction: string | undefined, percent: string | undefined, offset: number) => {
    const words = numberPhrase(whole, fraction, percent);
    const attached = offset > 0 && !/\s/.test(western[offset - 1]);
    return attached ? words.replace(/^اِ/u, 'ا') : words;
  });
  return spoken.split(/\s+/).filter(Boolean);
}
