/**
 * Arabic text -> Kokoro phonemes for Nabra, plus which word each phoneme belongs to (for word timings).
 *
 * A line-by-line port of the pipeline Nabra was trained with (nabra-onnx/web/nabra-g2p.js, checked there against
 * Python on 51 sentences and 240 words): misaki EspeakG2P(language="ar") -> phonemizer EspeakBackend
 * (preserve_punctuation, with_stress, tie='^', language_switch='remove-flags') -> espeak-ng 1.52.0 -> arabic_g2p
 * clean_phonemes. espeak-ng itself is passed in (`Espeak`), so this file has no WASM and is testable in Node.
 * The pronunciation fixes on top (shadda, «ال», tripled consonants, emphatics) live in fixes.ts.
 */
import { cleanPhonemes, collapseGeminates, markEmphatics } from './fixes';
import type { EmphaticsMode } from './fixes';

/** espeak-ng as phonemizer calls it: one piece of text (no punctuation) -> IPA with tie marks, clauses joined by spaces. */
export interface Espeak {
  phonemize(text: string): string;
}

export interface PhonemizeOptions {
  /** Collapse tripled consonants (fixes.ts); off = exactly the Python pipeline. */
  geminateFix?: boolean;
  emphatics?: EmphaticsMode;
}

/** Phonemes, and for every phoneme character the index of the word (in `words`) it came from: -1 space, -2 punctuation. */
export interface PhonemesWithWords {
  phonemes: string;
  /** Whitespace-separated pieces of the text that contain a letter or digit. */
  words: string[];
  wordOf: Int32Array;
  /** How phonemes were matched to words: each word one phoneme word, by phonemizing each word alone, or by length. */
  aligned: 'one-to-one' | 'per-word' | 'proportional';
}

// ── Python str semantics ──────────────────────────────────────────────────────
const PY_WHITESPACE = ' \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000';
/** Python's str.strip(). */
export function pyStrip(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && PY_WHITESPACE.includes(text[start])) start++;
  while (end > start && PY_WHITESPACE.includes(text[end - 1])) end--;
  return text.slice(start, end);
}
const replaceAll = (text: string, from: string, to: string) => text.split(from).join(to);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// ── phonemizer: Punctuation.preserve / restore ────────────────────────────────
const DEFAULT_MARKS = ';:,.!?¡¿—…"«»“”(){}[]';
// Python's \s (str patterns) also matches \x1c-\x1f and \x85; JavaScript's does not.
const PY_SPACE = '[\\s\\x1c-\\x1f\\x85]';
const MARKS_RE = new RegExp(`(${PY_SPACE}*[${escapeRegExp(DEFAULT_MARKS)}]+${PY_SPACE}*)+`, 'gu');

interface Mark {
  mark: string;
  position: 'B' | 'I' | 'E' | 'A';
}

function preserveLine(line: string): [string[], Mark[]] {
  const matches = Array.from(line.matchAll(MARKS_RE), match => match[0]);
  if (matches.length === 0) return [[line], []];
  if (matches.length === 1 && matches[0] === line) return [[], [{ mark: line, position: 'A' }]];
  const marks: Mark[] = matches.map((mark, i) => {
    if (i === 0 && line.startsWith(mark)) return { mark, position: 'B' };
    if (i === matches.length - 1 && line.endsWith(mark)) return { mark, position: 'E' };
    return { mark, position: 'I' };
  });
  const pieces: string[] = [];
  for (const { mark } of marks) {
    const split = line.split(mark);
    pieces.push(split[0]);
    line = split.slice(1).join(mark);
  }
  pieces.push(line);
  return [pieces, marks];
}

/** Punctuation.restore for one input line (every mark has index 0), word separator ' ', strip=False. */
function restore(pieces: string[], marksIn: Mark[]): string[] {
  let text = [...pieces];
  let marks = [...marksIn];
  const out: string[] = [];
  let pos = 0;
  while (text.length > 0 || marks.length > 0) {
    if (marks.length === 0) {
      for (const line of text) out.push(line.endsWith(' ') ? line : `${line} `);
      text = [];
    }
    else if (text.length === 0) {
      out.push(marks.map(mark => mark.mark).join(''));
      marks = [];
    }
    else if (pos !== 0) {
      out.push(text[0]);
      text = text.slice(1);
      pos += 1;
    }
    else {
      const { mark, position } = marks[0];
      marks = marks.slice(1);
      if (text[0].endsWith(' ')) text[0] = text[0].slice(0, -1);
      if (position === 'B') text[0] = mark + text[0];
      else if (position === 'E') {
        out.push(text[0] + mark + (mark.endsWith(' ') ? '' : ' '));
        text = text.slice(1);
        pos += 1;
      }
      else if (position === 'A') {
        out.push(mark + (mark.endsWith(' ') ? '' : ' '));
        pos += 1;
      }
      else if (text.length === 1) text[0] += mark;
      else {
        const first = text[0];
        text = text.slice(1);
        text[0] = first + mark + text[0];
      }
    }
  }
  return out;
}

// ── phonemizer: EspeakBackend._postprocess_line (with_stress, tie '^', strip=False) ──
function postprocessLine(raw: string): string {
  let line = replaceAll(replaceAll(pyStrip(raw), '\n', ' '), '  ', ' ');
  line = line.replace(/_+/g, '_').replace(/_ /g, ' ');
  if (/\(.+?\)/u.test(line)) line = line.replace(/\(.+?\)/gu, '');
  if (!line) return '';
  return line.split(' ').map(word => `${replaceAll(pyStrip(word), '͡', '^')} `).join('');
}

// ── misaki EspeakG2P (version None) ───────────────────────────────────────────
const E2M = Object.entries({
  'a^ɪ': 'I', 'a^ʊ': 'W', 'd^z': 'ʣ', 'd^ʒ': 'ʤ', 'e^ɪ': 'A',
  'o^ʊ': 'O', 'ə^ʊ': 'Q', 's^s': 'S', 't^s': 'ʦ', 't^ʃ': 'ʧ', 'ɔ^ɪ': 'Y',
}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)); // Python sorts by code point

const isBoundary = (char: string) => DEFAULT_MARKS.includes(char) || char === ' ';
const HAS_LETTER_OR_DIGIT = /\p{L}|\p{N}/u;

export class NabraG2P {
  constructor(private readonly espeak: Espeak) {}

  /** phonemizer EspeakBackend.phonemize([text]), first line. */
  private phonemizerLine(text: string): string | null {
    const [pieces, marks] = preserveLine(text);
    const phonemized = pieces.filter(piece => piece).map(piece => postprocessLine(this.espeak.phonemize(piece)));
    const restored = restore(phonemized, marks);
    return restored.length > 0 ? restored[0] : null;
  }

  /** misaki EspeakG2P.__call__: raw espeak IPA, with its emphatic marks still in. */
  misaki(text: string): string {
    text = replaceAll(replaceAll(text, '«', '“'), '»', '”');
    text = replaceAll(replaceAll(text, '(', '«'), ')', '»');
    const line = this.phonemizerLine(text);
    if (line === null) return '';
    let ps = pyStrip(line);
    for (const [from, to] of E2M) ps = replaceAll(ps, from, to);
    ps = replaceAll(replaceAll(ps, '^', ''), '-', '');
    return replaceAll(replaceAll(ps, '«', '('), '»', ')');
  }

  /** The phonemes the model gets. With no options this is exactly the Python pipeline's output. */
  phonemize(text: string, options: PhonemizeOptions = {}): string {
    const ps = cleanPhonemes(markEmphatics(this.misaki(text), options.emphatics ?? 'plain'));
    return options.geminateFix ? collapseGeminates(ps) : ps;
  }

  /**
   * Phonemes plus the word each phoneme belongs to. espeak usually gives one phoneme word per text word; a number or a
   * merge gives more, so each word is also phonemized alone to count its phoneme words (one cheap call per word).
   */
  phonemizeWithWords(text: string, options: PhonemizeOptions = {}): PhonemesWithWords {
    const phonemes = this.phonemize(text, options);
    const words = text.split(/\s+/u).filter(word => HAS_LETTER_OR_DIGIT.test(word));
    const phonemeWords: [number, number][] = [];
    for (let i = 0; i < phonemes.length;) {
      if (isBoundary(phonemes[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < phonemes.length && !isBoundary(phonemes[j])) j++;
      phonemeWords.push([i, j]);
      i = j;
    }
    let groups = words.map(word => Math.max(1, this.phonemize(word, options).split(' ').filter(piece => [...piece].some(char => !isBoundary(char))).length));
    let aligned: PhonemesWithWords['aligned'] = groups.every(count => count === 1) ? 'one-to-one' : 'per-word';
    if (groups.reduce((sum, count) => sum + count, 0) !== phonemeWords.length) {
      // Fallback: spread the phoneme words over the text words by letter count.
      aligned = 'proportional';
      const lengths = words.map(word => (word.match(/\p{L}|\p{N}/gu) ?? []).length || 1);
      const total = lengths.reduce((sum, length) => sum + length, 0);
      let sum = 0;
      let previous = 0;
      groups = lengths.map((length, k) => {
        sum += length;
        const upTo = k === lengths.length - 1 ? phonemeWords.length : Math.round((sum / total) * phonemeWords.length);
        const count = Math.max(0, upTo - previous);
        previous = upTo;
        return count;
      });
    }
    const wordOf = new Int32Array(phonemes.length).fill(-1);
    for (let i = 0; i < phonemes.length; i++) if (phonemes[i] !== ' ') wordOf[i] = -2;
    let next = 0;
    groups.forEach((count, word) => {
      for (let k = 0; k < count && next < phonemeWords.length; k++, next++) {
        const [start, end] = phonemeWords[next];
        wordOf.fill(word, start, end);
      }
    });
    return { phonemes, words, wordOf, aligned };
  }
}

/**
 * Kokoro token ids for a phoneme string: [0, ...ids, 0]; characters outside the vocab are dropped (as in KModel.forward).
 * `wordOfToken` follows the ids. Indexed by UTF-16 unit like `wordOf` (every IPA symbol used is in the BMP).
 */
export function tokenize(phonemes: string, vocab: Readonly<Record<string, number>>, wordOf?: Int32Array): { ids: number[]; wordOfToken: number[] } {
  const ids = [0];
  const wordOfToken = [-1];
  for (let i = 0; i < phonemes.length; i++) {
    const id = vocab[phonemes[i]];
    if (id === undefined) continue;
    ids.push(id);
    wordOfToken.push(wordOf ? wordOf[i] : -1);
  }
  ids.push(0);
  wordOfToken.push(-1);
  return { ids, wordOfToken };
}
