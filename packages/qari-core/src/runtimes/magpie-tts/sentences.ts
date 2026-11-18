import type { SpokenWord } from '../../normalization/normalize';
import { splitDisplayWords } from '../../timings/word-timings';

/** Bayan says one sentence per take; longer text is split here (Q1 reads a whole text as one request). */
// Diacritics (tashkeel and Quranic marks) don't count as letters. Escaped: typed as characters, the marks get reordered.
const HARAKAT = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const SENTENCE_END = /[.!?؟۔…]["'»”)\]]*$/;
const CLAUSE_END = /[،,؛;:]["'»”)\]]*$/;
const letterCount = (words: readonly string[]) => words.join('').replace(HARAKAT, '').length;

/** Greedily packs runs of word indexes into chunks of at most `max` letters (a single longer word stays whole). */
function pack(runs: number[][], words: readonly string[], max: number): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  for (const run of runs) {
    const candidate = [...current, ...run];
    if (current.length === 0 || letterCount(candidate.map(i => words[i])) <= max) current = candidate;
    else {
      chunks.push(current);
      current = run;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Splits word indexes into runs, closing a run after each word `endsRun` accepts. */
function runs(indexes: number[], endsRun: (index: number) => boolean): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  for (const index of indexes) {
    current.push(index);
    if (endsRun(index)) {
      out.push(current);
      current = [];
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Groups words into sentences of at most `max` letters (diacritics don't count), never splitting a word, and returns
 * each sentence as the indexes of its words, so timings map back to the words. A sentence ends at . ! ? ؟ … or where
 * `breakAfter` says (a line break); a longer one is split at clause marks (، , ؛ ; :), then by words. Unlike splitText
 * in bayan-onnx/web/bayan-worker.js, sentences are never packed together: two-sentence takes ended early more often.
 */
export function groupSentences(words: readonly string[], max = 180, breakAfter: readonly boolean[] = []): number[][] {
  const sentences = runs(words.map((_, i) => i), i => SENTENCE_END.test(words[i]) || Boolean(breakAfter[i]));
  return sentences.flatMap((sentence) => {
    if (letterCount(sentence.map(i => words[i])) <= max) return [sentence];
    return pack(runs(sentence, i => CLAUSE_END.test(words[i])), words, max)
      .flatMap(clause => (letterCount(clause.map(i => words[i])) <= max ? [clause] : pack(clause.map(i => [i]), words, max)));
  });
}

/** Per spoken word: does a line break follow it in the text (a sentence ends there)? */
export function lineBreaksAfter(text: string, spokenWords: readonly SpokenWord[]): boolean[] {
  const display = splitDisplayWords(text);
  return spokenWords.map((word, i) => {
    const lastOfItsWord = i + 1 === spokenWords.length || spokenWords[i + 1].displayIndex !== word.displayIndex;
    const next = display[word.displayIndex + 1];
    return lastOfItsWord && next !== undefined && text.slice(display[word.displayIndex].charEnd, next.charStart).includes('\n');
  });
}
