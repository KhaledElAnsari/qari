/**
 * Rule-based MSA phonetiser: Buckwalter text → phoneme string.
 * Port of nipponjo/tts_arabic `text/phonetise_buckwalter.py` (itself adapted from Nawar Halabi's Arabic-Phonetiser).
 * Quirks of the original are kept on purpose so token ids match the models' training (see docs/decisions.md).
 */

/** One phone slot: a fixed phone, or a list of alternatives (only the first is used, as in the original). */
type Phone = string | string[];

const UNAMBIGUOUS_CONSONANTS: Readonly<Record<string, string>> = {
  'b': 'b', '*': '*', 'T': 'T', 'm': 'm', 't': 't', 'r': 'r', 'Z': 'Z', 'n': 'n',
  '^': '^', 'z': 'z', 'E': 'E', 'h': 'h', 'j': 'j', 's': 's', 'g': 'g', 'H': 'H',
  'q': 'q', 'f': 'f', 'x': 'x', 'S': 'S', '$': '$', 'd': 'd', 'D': 'D', 'k': 'k',
  '>': '<', '\'': '<', '}': '<', '&': '<', '<': '<',
};

const LAM_KEPT = 'l';
const LAM_OMITTED = '';
const TA_MARBUTA_READ = 't';
const TA_MARBUTA_SILENT = '';
const MADDA_PLAIN: Phone = ['<', 'aa'];
const MADDA_EMPHATIC: Phone = ['<', 'AA'];

/** [plain, emphatic] × [default, shortened] for the vowel letters, as in the original's vowelMap. */
const VOWELS: Readonly<Record<string, readonly [readonly [string, string], readonly [string, string]]>> = {
  'A': [['aa', ''], ['AA', '']],
  'Y': [['aa', ''], ['AA', '']],
  'w': [['uu0', 'uu1'], ['UU0', 'UU1']],
  'y': [['ii0', 'ii1'], ['II0', 'II1']],
  'u': [['u0', 'u1'], ['U0', 'U1']],
  'i': [['i0', 'i1'], ['I0', 'I1']],
};
const FATHA_PLAIN = 'a';
const FATHA_EMPHATIC = 'A';
const VOWEL_LETTERS = new Set([...Object.keys(VOWELS), 'a']);

const DIACRITICS = new Set(['o', 'a', 'u', 'i', 'F', 'N', 'K', '~']);
const DIACRITICS_WITHOUT_SHADDA = new Set(['o', 'a', 'u', 'i', 'F', 'N', 'K']);
const EMPHATICS = new Set(['D', 'S', 'T', 'Z', 'g', 'x', 'q']);
const FORWARD_EMPHATICS = new Set(['g', 'x']);
const CONSONANTS = new Set(['>', '<', '}', '&', '\'', 'b', 't', '^', 'j', 'H', 'x', 'd', '*', 'r',
  'z', 's', '$', 'S', 'D', 'T', 'Z', 'E', 'g', 'f', 'q', 'k', 'l', 'm', 'n', 'h', '|']);
const PUNCTUATION = new Set(['.', ',', '?', '!']);

/** Words with fixed irregular pronunciations, keyed by their consonant skeleton. */
const FIXED_WORDS: Readonly<Record<string, string | string[]>> = {
  'h*A': ['h aa * aa', 'h aa * a'],
  'h*h': ['h aa * i0 h i0', 'h aa * i1 h'],
  'h*An': ['h aa * aa n i0', 'h aa * aa n'],
  'h&lA\'': ['h aa < u0 l aa < i0', 'h aa < u0 l aa <'],
  '*lk': ['* aa l i0 k a', '* aa l i0 k'],
  'k*lk': ['k a * aa l i0 k a', 'k a * aa l i1 k'],
  '*lkm': '* aa l i0 k u1 m',
  '>wl}k': ['< u0 l aa < i0 k a', '< u0 l aa < i1 k'],
  'Th': 'T aa h a',
  'lkn': ['l aa k i0 nn a', 'l aa k i1 n'],
  'lknh': 'l aa k i0 nn a h u0',
  'lknhm': 'l aa k i0 nn a h u1 m',
  'lknk': ['l aa k i0 nn a k a', 'l aa k i0 nn a k i0'],
  'lknkm': 'l aa k i0 nn a k u1 m',
  'lknkmA': 'l aa k i0 nn a k u0 m aa',
  'lknnA': 'l aa k i0 nn a n aa',
  'AlrHmn': ['rr a H m aa n i0', 'rr a H m aa n'],
  'Allh': ['ll aa h i0', 'll aa h', 'll AA h u0', 'll AA h a', 'll AA h', 'll A'],
  'h*yn': ['h aa * a y n i0', 'h aa * a y n'],
  'nt': 'n i1 t',
  'fydyw': 'v i0 d y uu1',
  'lndn': 'l A n d u1 n',
};

const isUnambiguousConsonant = (letter: string) => Object.hasOwn(UNAMBIGUOUS_CONSONANTS, letter);

/** Pronunciations from the fixed-word table that fit the word's last letter (empty when none). */
function fixedPronunciations(word: string): string[][] {
  const letters = Array.from(word);
  const last = letters.at(-1) ?? '';
  // A list means membership; a bare string means a substring test, as the original's `in` does on strings.
  let lastPhones: string[] | string = last;
  if (last === 'a') lastPhones = ['a', 'A'];
  else if (last === 'A') lastPhones = ['aa'];
  else if (last === 'u') lastPhones = ['u0'];
  else if (last === 'i') lastPhones = ['i0'];
  else if (isUnambiguousConsonant(last)) lastPhones = [UNAMBIGUOUS_CONSONANTS[last]];

  const skeleton = word.replace(/[^h*Ahn'>wl}kmyTtfd]/g, '');
  const entry = Object.hasOwn(FIXED_WORDS, skeleton) ? FIXED_WORDS[skeleton] : undefined;
  if (entry === undefined) return [];
  if (typeof entry === 'string') return [entry.split(' ')];

  const pronunciations: string[][] = [];
  for (const pronunciation of entry) {
    const phones = pronunciation.split(' ');
    const lastPhone = phones[phones.length - 1];
    const fits = Array.isArray(lastPhones) ? lastPhones.includes(lastPhone) : lastPhones.includes(lastPhone);
    if (fits) pronunciations.push(phones);
  }
  return pronunciations;
}

/** Normalises an utterance in Buckwalter and splits it into words (empty words kept, as in the original). */
export function preprocessUtterance(utterance: string): string[] {
  let text = utterance
    .replaceAll('AF', 'F')
    .replaceAll('ـ', '')
    .replaceAll('o', '')
    .replaceAll('aA', 'A')
    .replaceAll('aY', 'Y')
    .replaceAll(' A', ' ')
    .replaceAll('F', 'an')
    .replaceAll('N', 'un')
    .replaceAll('K', 'in')
    .replaceAll('|', '>A')
    .replaceAll('i~', '~i')
    .replaceAll('a~', '~a')
    .replaceAll('u~', '~u');

  // A hamza seat without a following short vowel gets one added.
  text = text
    .replace(/Ai/g, '<i')
    .replace(/Aa/g, '>a')
    .replace(/Au/g, '>u')
    .replace(/^>([^auAw])/, '>a$1')
    .replace(/ >([^auAw ])/g, ' >a$1')
    .replace(/<([^i])/g, '<i$1')
    .replace(/(\S)([.?,!])/g, '$1 $2');

  return text.split(' ');
}

/** Phonetises one Buckwalter word into phones; punctuation comes back as itself. */
export function processWord(word: string): string[] | string {
  if (PUNCTUATION.has(word)) return word;

  const fixed = fixedPronunciations(word);
  const letters = Array.from(`bb${word}ee`);
  const phones: Phone[] = [];
  let emphaticContext = false;

  for (let index = 2; index < letters.length - 2; index++) {
    const letter = letters[index];
    const next = letters[index + 1];
    const afterNext = letters[index + 2];
    const previous = letters[index - 1];
    const beforePrevious = letters[index - 2];

    // The original meant to exempt r and l here; its list held one odd string, so only emphatics are exempt.
    if ((CONSONANTS.has(letter) || letter === 'w' || letter === 'y') && !EMPHATICS.has(letter)) emphaticContext = false;
    if (EMPHATICS.has(letter)) emphaticContext = true;
    if (EMPHATICS.has(next) && !FORWARD_EMPHATICS.has(next)) emphaticContext = true;
    const variant = emphaticContext ? 1 : 0;

    if (isUnambiguousConsonant(letter)) phones.push(UNAMBIGUOUS_CONSONANTS[letter]);

    if (letter === 'l') {
      // Sun letters: the l of the article is silent before a doubled consonant.
      const isSunLetterLam = !DIACRITICS.has(next) && !VOWEL_LETTERS.has(next) && afterNext === '~';
      phones.push(isSunLetterLam ? LAM_OMITTED : LAM_KEPT);
    }

    if (letter === '~' && previous !== 'w' && previous !== 'y' && phones.length > 0) {
      const last = phones[phones.length - 1];
      phones[phones.length - 1] = Array.isArray(last) ? [...last, ...last] : last + last;
    }

    if (letter === '|') phones.push(emphaticContext ? MADDA_EMPHATIC : MADDA_PLAIN);

    if (letter === 'p') phones.push(DIACRITICS.has(next) ? TA_MARBUTA_READ : TA_MARBUTA_SILENT);

    if (VOWEL_LETTERS.has(letter)) {
      if (letter === 'w' || letter === 'y') pushWawOrYa(phones, letter, { next, afterNext, previous }, variant);
      if (letter === 'u' || letter === 'i') {
        const isMildened = (isUnambiguousConsonant(next) || next === 'l') && afterNext === 'e' && letters.length > 7;
        phones.push(VOWELS[letter][variant][isMildened ? 1 : 0]);
      }
      if (letter === 'a' || letter === 'A' || letter === 'Y') pushAlifOrFatha(phones, letter, { next, previous, beforePrevious }, variant);
    }
  }

  const pronunciation = fixed.length > 0 ? fixed[0] : firstPronunciation(phones);
  return cleanUpPronunciation(pronunciation);
}

/** Waw and ya can be consonants or long vowels; their gemination mixes both. */
function pushWawOrYa(phones: Phone[], letter: 'w' | 'y', around: { next: string; afterNext: string; previous: string }, variant: 0 | 1): void {
  const { next, afterNext, previous } = around;
  const longVowel = VOWELS[letter][variant][0];
  const plainLongVowel = VOWELS[letter][0][0];
  const isConsonantContext = DIACRITICS_WITHOUT_SHADDA.has(next) || next === 'A' || next === 'Y'
    || ((next === 'w' || next === 'y') && !(DIACRITICS.has(afterNext) || ['A', 'w', 'y'].includes(afterNext)))
    || (DIACRITICS_WITHOUT_SHADDA.has(previous) && (CONSONANTS.has(next) || next === 'e'));

  if (isConsonantContext) {
    const isLongVowel = (letter === 'w' && previous === 'u' && !['a', 'i', 'A', 'Y'].includes(next))
      || (letter === 'y' && previous === 'i' && !['a', 'u', 'A', 'Y'].includes(next));
    if (isLongVowel) phones.push(longVowel);
    else if (next === 'A' && letter === 'w' && afterNext === 'e') phones.push([letter, plainLongVowel]);
    else phones.push(letter);
  }
  else if (next === '~') {
    const isDoubleConsonant = previous === 'a' || (letter === 'w' && (previous === 'i' || previous === 'y')) || (letter === 'y' && (previous === 'w' || previous === 'u'));
    if (isDoubleConsonant) phones.push(letter, letter);
    else phones.push(plainLongVowel, letter);
  }
  // A final waw or ya can be shortened.
  else if ((CONSONANTS.has(previous) || previous === 'u' || previous === 'i') && next === 'e') phones.push([longVowel, longVowel.slice(1)]);
  else phones.push(longVowel);
}

/** Alif and fatha, including the silent alif of the article and of waw al-jama'a. */
function pushAlifOrFatha(phones: Phone[], letter: 'a' | 'A' | 'Y', around: { next: string; previous: string; beforePrevious: string }, variant: 0 | 1): void {
  const { next, previous, beforePrevious } = around;
  if (letter === 'a') {
    phones.push(variant === 1 ? FATHA_EMPHATIC : FATHA_PLAIN);
    return;
  }
  const vowel = VOWELS[letter];
  if (letter === 'A' && (previous === 'w' || previous === 'k') && beforePrevious === 'b') phones.push(['a', vowel[0][0]]);
  else if (letter === 'A' && (previous === 'u' || previous === 'i')) return;
  else if (letter === 'A' && previous === 'w' && next === 'e') phones.push([vowel[0][0], vowel[0][1]]);
  else if (next === 'e') phones.push(variant === 1 ? [vowel[1][0], FATHA_EMPHATIC] : [vowel[0][0], FATHA_PLAIN]);
  else phones.push(vowel[variant][0]);
}

/** Picks the first alternative of every slot and drops empty phones. */
function firstPronunciation(phones: Phone[]): string[] {
  const pronunciation: string[] = [];
  for (const phone of phones) {
    const chosen = Array.isArray(phone) ? phone[0] : phone;
    if (chosen !== '') pronunciation.push(chosen);
  }
  return pronunciation;
}

/** Merges duplicate consecutive vowels and duplicate w/y, exactly as the original's house-keeping pass. */
function cleanUpPronunciation(input: string[]): string[] {
  const pronunciation = [...input];
  const toDelete: number[] = [];
  let previous = '';
  for (let i = 0; i < pronunciation.length; i++) {
    const letter = pronunciation[i];
    if (['aa', 'uu0', 'ii0', 'AA', 'UU0', 'II0'].includes(letter) && previous.toLowerCase() === letter.slice(1).toLowerCase()) {
      toDelete.push(i - 1);
      pronunciation[i] = pronunciation[i - 1][0] + pronunciation[i - 1];
    }
    if ((letter === 'u0' || letter === 'i0') && previous.toLowerCase() === letter.toLowerCase()) {
      toDelete.push(i - 1);
      pronunciation[i] = pronunciation[i - 1];
    }
    if ((letter === 'y' || letter === 'w') && previous === letter) {
      pronunciation[i - 1] += pronunciation[i - 1];
      toDelete.push(i);
    }
    previous = letter;
  }
  for (let i = toDelete.length - 1; i >= 0; i--) pronunciation.splice(toDelete[i], 1);
  return pronunciation;
}

/** Phonetises a Buckwalter utterance: words joined by ' + ', phones by spaces, '-' becomes 'sil'. */
export function processUtterance(utterance: string): string {
  const words: string[][] = [];
  for (const word of preprocessUtterance(utterance)) {
    if (word === '-' || word === 'sil') {
      words.push(['sil']);
      continue;
    }
    const phones = processWord(word);
    if (typeof phones === 'string' && words.length > 0) words[words.length - 1].push(phones);
    else words.push(typeof phones === 'string' ? [phones] : phones);
  }
  return words.map(phones => phones.join(' ')).join(' + ');
}
