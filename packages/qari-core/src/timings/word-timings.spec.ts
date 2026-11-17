import { prepareArabicText } from '../frontends/arabic-phonetiser/prepare-text';
import { SEPARATOR_TOKEN, symbolId } from '../frontends/arabic-phonetiser/symbols';
import { arabicToTokens } from '../frontends/arabic-phonetiser/tokenize';
import { computeWordTimings, splitDisplayWords } from './word-timings';
import { normalizeForSpeech } from '../normalization/normalize';
import type { WordTimings } from './word-timings';

// Made-up frame counts: 2 per sound, 10 per punctuation pause, 3 per word separator. 0.01 s per frame.
const SECONDS_PER_FRAME = 0.01;
const framesFor = (token: string) => token === SEPARATOR_TOKEN ? 3 : /^[.,?!]$/.test(token) ? 10 : 2;

/** Tokenises like the adapter does (prepare → tokens → drop unknown) and times it. */
function timeText(text: string): WordTimings {
  const tokens = arabicToTokens(prepareArabicText(text)).filter(token => symbolId(token) !== undefined);
  const result = computeWordTimings({ text, tokens, durations: tokens.map(framesFor), secondsPerFrame: SECONDS_PER_FRAME });
  if ('problem' in result) throw new Error(result.problem);
  return result;
}

describe('word timings (Q4)', () => {
  it('splits displayed words on whitespace and keeps their place in the text', () => {
    expect(splitDisplayWords('  يَا  صَدِيقِي\nهَذَا ')).toEqual([
      { displayIndex: 0, text: 'يَا', charStart: 2, charEnd: 5 },
      { displayIndex: 1, text: 'صَدِيقِي', charStart: 7, charEnd: 15 },
      { displayIndex: 2, text: 'هَذَا', charStart: 16, charEnd: 21 },
    ]);
  });

  it('gives each word its own span, in order, with the separator pause between words', () => {
    const timings = timeText('اَلسَّلامُ عَلَيكُم');
    expect(timings.words.map(word => word.text)).toEqual(['اَلسَّلامُ', 'عَلَيكُم']);
    const [first, second] = timings.words;
    expect(first.start).toBe(0);
    expect(first.end).toBeGreaterThan(first.start);
    expect(second.start).toBeCloseTo(first.end + 3 * SECONDS_PER_FRAME, 3);
    expect(second.end).toBeGreaterThan(second.start);
    expect(timings.duration).toBeGreaterThanOrEqual(second.end);
    expect(timings.words.every(word => word.spoken)).toBe(true);
  });

  it('keeps a punctuation pause out of the word it follows', () => {
    const [first, second] = timeText('سَلامٌ، يَا').words;
    expect(first.text).toBe('سَلامٌ،');
    // The comma (10 frames) and the separator (3) sit between the two words.
    expect(second.start - first.end).toBeCloseTo(13 * SECONDS_PER_FRAME, 3);
  });

  it('times words the voice can\'t read as zero-length, where the reading is at that point', () => {
    const timings = timeText('MIT سَلامٌ .');
    expect(timings.words).toHaveLength(1);
    expect(timings.displayWords.map(word => [word.text, word.spokenIndexes])).toEqual([['MIT', []], ['سَلامٌ', [0]], ['.', []]]);
    expect(timings.displayWords[0]).toMatchObject({ start: 0, end: 0 });
    expect(timings.displayWords[2].start).toBe(timings.words[0].end);
    expect(timings.ranges[1]).toEqual({ charStart: 4, charEnd: 10 });
  });

  it('matches every word of a longer sentence to its own group', () => {
    const text = 'اَلسَّلامُ عَلَيكُم يَا صَدِيقِي، هَذَا قَارِئٌ يَقْرَأُ النُّصُوصَ بِصَوْتٍ وَاضِحٍ.';
    const timings = timeText(text);
    expect(timings.displayWords.map(word => word.spokenIndexes)).toEqual(text.split(' ').map((_, index) => [index]));
    const starts = timings.words.map(word => word.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('summarises the reading: heard words, words per minute and the share of pauses', () => {
    // Two words of 3 tokens each (b a + separator): sounds 2 + 2 frames, separator 6 frames, then end of sequence 10.
    const tokens = ['b', 'a', SEPARATOR_TOKEN, 'b', 'a', SEPARATOR_TOKEN, '_eos_'];
    const timings = computeWordTimings({ text: 'بَ بَ', tokens, durations: [2, 2, 6, 2, 2, 6, 10], secondsPerFrame: 0.1 });
    if ('problem' in timings) throw new Error(timings.problem);
    // 30 frames = 3 s; words heard for 4 + 4 = 8 frames, so 22 of 30 frames are pauses.
    expect(timings.stats).toEqual({ words: 2, wordsPerMinute: 40, pausePercent: 73.3 });
  });

  it('leaves words the voice can\'t read out of the stats', () => {
    expect(timeText('MIT سَلامٌ').stats.words).toBe(1);
  });

  it('times a number across the words it is said as, with "said" for each (normalization word map)', () => {
    const text = 'عَامِ 1950، وَلَهُ';
    const spokenWords = normalizeForSpeech(text);
    const tokens = arabicToTokens(prepareArabicText(spokenWords.map(word => word.text).join(' '))).filter(token => symbolId(token) !== undefined);
    const timings = computeWordTimings({ text, spokenWords, tokens, durations: tokens.map(framesFor), secondsPerFrame: SECONDS_PER_FRAME });
    if ('problem' in timings) throw new Error(timings.problem);
    expect(timings.words.map(word => [word.text, word.said])).toEqual([
      ['عَامِ', undefined], ['1950،', 'أَلْف'], ['1950،', 'وَتِسْعِمِئَة'], ['1950،', 'وَخَمْسِينَ،'], ['وَلَهُ', undefined],
    ]);
    const year = timings.displayWords[1];
    expect(year.spokenIndexes).toEqual([1, 2, 3]);
    expect([year.start, year.end]).toEqual([timings.words[1].start, timings.words[3].end]);
    expect(timings.stats.words).toBe(3);
  });

  it('reports a problem instead of guessing when tokens and words don\'t line up', () => {
    const tokens = ['b', 'a', SEPARATOR_TOKEN, '_eos_'];
    expect(computeWordTimings({ text: 'بَ بَ', tokens, durations: [2, 2, 3, 1], secondsPerFrame: 0.01 })).toEqual({ problem: expect.stringContaining('1 word groups') });
    expect(computeWordTimings({ text: 'بَ', tokens, durations: [2, 2], secondsPerFrame: 0.01 })).toEqual({ problem: expect.stringContaining('4 tokens but 2 durations') });
  });
});
