import { splitDisplayWords } from '../timings/word-timings';
import { normalizeNumbersInWord } from './arabic-numbers';

/** One word the voice says, and the displayed word it comes from (the word map). */
export interface SpokenWord {
  text: string;
  displayIndex: number;
}

/**
 * Turns text into what the voice should say, word by word: numbers become words (Q3). Every spoken word remembers its
 * displayed word, so "1950" is shown as one word but timed across the three it's read as.
 * With normalization off (developer switch), each displayed word is said as written.
 */
export function normalizeForSpeech(text: string, options: { enabled?: boolean } = {}): SpokenWord[] {
  const enabled = options.enabled ?? true;
  return splitDisplayWords(text).flatMap(word => (enabled ? normalizeNumbersInWord(word.text) : [word.text])
    .map(spoken => ({ text: spoken, displayIndex: word.displayIndex })));
}
