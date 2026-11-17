import type { BayanTokenizerData } from './bayan-config';

const ARABIC_LETTER = /[\u0621-\u064A\u0671-\u06D3]/;
/** tokenWords value of a space, padding or the end id. */
export const NO_WORD = -1;
/** tokenWords value of a punctuation mark: the voice may pause there. */
export const PUNCTUATION = -2;

/**
 * NeMo's arabic_MSA_chartokenizer, as Bayan was trained with it: one id per letter, diacritic or kept punctuation mark.
 * Twin of ArabicTokenizerPort in bayan-onnx/export/export_bayan_onnx.py, checked there against NeMo itself.
 */
export class BayanTokenizer {
  private readonly tokenIds: Map<string, number>;
  private readonly punct: Set<string>;
  private readonly space: string;

  constructor(private readonly data: BayanTokenizerData) {
    this.tokenIds = new Map(data.tokens.map((token, i) => [token, i]));
    this.punct = new Set(data.punct);
    this.space = data.tokens[0];
  }

  /** Text to model ids: unknown characters are dropped, runs of spaces collapse, the end id is appended. */
  encode(text: string): number[] {
    return this.encodeWithWords(text).ids;
  }

  /**
   * The same ids, plus for every id the word it belongs to (index among the text's whitespace-separated words), or
   * PUNCTUATION / NO_WORD (spaces, padding, the end id). Used for word timings.
   */
  encodeWithWords(text: string): { ids: number[]; tokenWords: number[]; wordCount: number } {
    const kept: string[] = [];
    const owners: number[] = [];
    let word = -1;
    let inSpace = true;
    for (const char of text.normalize('NFC').replaceAll('’', '\'')) {
      if (/\s/.test(char)) inSpace = true;
      else if (inSpace) {
        word++;
        inSpace = false;
      }
      if (char === this.space && kept.length > 0 && kept[kept.length - 1] !== this.space) {
        kept.push(char);
        owners.push(NO_WORD);
      }
      else if (this.tokenIds.has(char) && char !== this.space) {
        kept.push(char);
        owners.push(this.punct.has(char) ? PUNCTUATION : word);
      }
      else if (this.punct.has(char)) {
        kept.push(char);
        owners.push(PUNCTUATION);
      }
    }
    while (kept.length > 0 && kept[kept.length - 1] === this.space) {
      kept.pop();
      owners.pop();
    }
    if (this.data.pad_with_space) {
      kept.unshift(this.space);
      kept.push(this.space);
      owners.unshift(NO_WORD);
      owners.push(NO_WORD);
    }
    return {
      ids: [...kept.map(char => this.data.offset + (this.tokenIds.get(char) as number)), this.data.eos_id],
      tokenWords: [...owners, NO_WORD],
      wordCount: word + 1,
    };
  }

  /**
   * True when the text has an Arabic letter the voice knows. Bayan's character set also has Latin letters (NeMo keeps
   * them, and so does encode()), but text with no Arabic letter at all is 'nothing to read', as for every qari voice.
   */
  hasSpeech(text: string): boolean {
    for (const char of text.normalize('NFC')) {
      if (ARABIC_LETTER.test(char) && this.tokenIds.has(char)) return true;
    }
    return false;
  }
}
