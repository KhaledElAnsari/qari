/**
 * Timing file format shared with Maqroo2 (PRD 5.4, binding). Times are seconds with 3 decimals.
 * Produced from Q4 on; the type and its JSON schema (schemas/timing-file.schema.json) are fixed now.
 */
export interface TimingFile {
  /** Maqroo2 page number; optional elsewhere. */
  page?: number;
  audio: string;
  duration: number;
  words: SpokenWordTiming[];
  displayWords: DisplayWordTiming[];
}

/** One spoken word. */
export interface SpokenWordTiming {
  /** Spoken word position. */
  index: number;
  /** Displayed word it belongs to. */
  displayIndex: number;
  text: string;
  /** Spoken form, present only when it differs from `text`. */
  said?: string;
  start: number;
  end: number;
  spoken: boolean;
}

/** One displayed word, spanning from its first spoken word's start to its last spoken word's end. */
export interface DisplayWordTiming {
  displayIndex: number;
  text: string;
  start: number;
  end: number;
  spokenIndexes: number[];
}
