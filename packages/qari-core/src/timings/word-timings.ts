import { prepareArabicText } from '../frontends/arabic-phonetiser/prepare-text';
import { isSpokenToken, SEPARATOR_TOKEN } from '../frontends/arabic-phonetiser/symbols';
import type { DisplayWordTiming, SpokenWordTiming } from './timing-file';

/** A displayed word: whitespace-separated, as the listener sees it, with its place in the text. */
export interface DisplayWord {
  displayIndex: number;
  text: string;
  /** UTF-16 offsets into the text, end exclusive (for highlighting). */
  charStart: number;
  charEnd: number;
}

/** Word timings for one piece of text; the same shapes as the timing file (PRD 5.4), plus where each word sits in the text. */
export interface WordTimings {
  /** Seconds of audio. */
  duration: number;
  words: SpokenWordTiming[];
  displayWords: DisplayWordTiming[];
  /** Per display word, its place in the text (same order as `displayWords`). */
  ranges: { charStart: number; charEnd: number }[];
}

export interface WordTimingsInput {
  /** The text exactly as passed to speak or synthesize. */
  text: string;
  /** Model tokens that reached the model, in order (unknown tokens already removed), one per duration. */
  tokens: readonly string[];
  /** Frames per token, from the model's durations output. */
  durations: readonly number[];
  /** Seconds one frame lasts: audio samples ÷ total frames ÷ sample rate. */
  secondsPerFrame: number;
}

const PUNCTUATION_ONLY = /^[.,?!]+$/;
const seconds = (frames: number, secondsPerFrame: number) => Math.round(frames * secondsPerFrame * 1000) / 1000;

/** Splits text into displayed words: every run of non-whitespace is one word. */
export function splitDisplayWords(text: string): DisplayWord[] {
  return Array.from(text.matchAll(/\S+/g), (match, displayIndex) => ({
    displayIndex,
    text: match[0],
    charStart: match.index,
    charEnd: match.index + match[0].length,
  }));
}

/**
 * Which display word each token group belongs to. The phonetiser ends every word with a separator token; a word made
 * only of punctuation joins the word before it (as in the phonetiser), and a word with nothing the voice can read
 * (Latin letters, symbols) produces no group at all.
 */
function groupOwners(displayWords: DisplayWord[]): number[] {
  const owners: number[] = [];
  for (const word of displayWords) {
    const prepared = prepareArabicText(word.text);
    if (prepared === '') continue;
    if (PUNCTUATION_ONLY.test(prepared) && owners.length > 0) continue;
    owners.push(word.displayIndex);
  }
  return owners;
}

/**
 * Turns the model's per-token frame counts into word timings. A word runs from its first sounding token to its last,
 * so the pause after a word or a comma belongs to no word. Returns a reason instead when the tokens and the words
 * don't line up (the caller then plays the audio without timings).
 */
export function computeWordTimings(input: WordTimingsInput): WordTimings | { problem: string } {
  const { text, tokens, durations, secondsPerFrame } = input;
  if (tokens.length !== durations.length) return { problem: `${tokens.length} tokens but ${durations.length} durations.` };

  const displayWords = splitDisplayWords(text);
  const owners = groupOwners(displayWords);

  // Walk the tokens once, closing a group at each separator.
  const groups: { start: number; end: number; spoken: boolean }[] = [];
  let frame = 0;
  let groupStart = 0;
  let firstSound: number | null = null;
  let lastSoundEnd = 0;
  tokens.forEach((token, i) => {
    const length = durations[i];
    if (token === SEPARATOR_TOKEN) {
      groups.push(firstSound === null
        ? { start: groupStart, end: groupStart, spoken: false }
        : { start: firstSound, end: lastSoundEnd, spoken: lastSoundEnd > firstSound });
      frame += length;
      groupStart = frame;
      firstSound = null;
      return;
    }
    if (isSpokenToken(token)) {
      firstSound ??= frame;
      lastSoundEnd = frame + length;
    }
    frame += length;
  });
  if (groups.length !== owners.length) return { problem: `${groups.length} word groups in the tokens but ${owners.length} readable words in the text.` };

  const words: SpokenWordTiming[] = groups.map((group, index) => ({
    index,
    displayIndex: owners[index],
    text: displayWords[owners[index]].text,
    start: seconds(group.start, secondsPerFrame),
    end: seconds(group.end, secondsPerFrame),
    spoken: group.spoken,
  }));

  let previousEnd = 0;
  const timedDisplayWords: DisplayWordTiming[] = displayWords.map((word) => {
    const spokenIndexes = words.filter(spoken => spoken.displayIndex === word.displayIndex).map(spoken => spoken.index);
    if (spokenIndexes.length === 0) {
      // Nothing to say (e.g. "MIT"): a zero-length word where the reading is at that point.
      return { displayIndex: word.displayIndex, text: word.text, start: previousEnd, end: previousEnd, spokenIndexes };
    }
    const start = words[spokenIndexes[0]].start;
    const end = words[spokenIndexes[spokenIndexes.length - 1]].end;
    previousEnd = end;
    return { displayIndex: word.displayIndex, text: word.text, start, end, spokenIndexes };
  });

  return {
    duration: seconds(frame, secondsPerFrame),
    words,
    displayWords: timedDisplayWords,
    ranges: displayWords.map(({ charStart, charEnd }) => ({ charStart, charEnd })),
  };
}
