import { MAX_NUMBER, normalizeNumbersInWord, numberToWords, readDigits, toWesternDigits } from './arabic-numbers';
import { normalizeForSpeech } from './normalize';

describe('Arabic numbers (Q3)', () => {
  it.each([
    [0, 'صِفْر'],
    [7, 'سَبْعَة'],
    [11, 'أَحَدَ عَشَرَ'],
    [23, 'ثَلَاثَة وَعِشْرِينَ'],
    [100, 'مِئَة'],
    [1948, 'أَلْف وَتِسْعِمِئَة وَثَمَانِيَة وَأَرْبَعِينَ'],
    [2026, 'أَلْفَيْنِ وَسِتَّة وَعِشْرِينَ'],
    [3000, 'ثَلَاثَةِ آلَاف'],
    [10000, 'عَشَرَةِ آلَاف'],
    [11000, 'أَحَدَ عَشَرَ أَلْفا'],
    [100000, 'مِئَةِ أَلْف'],
    [250000, 'مِئَتَيْنِ وَخَمْسِينَ أَلْفا'],
    [103000, 'مِئَة وَثَلَاثَةِ آلَاف'],
    [1000000, 'مِلْيُون'],
    [2500000, 'مِلْيُونَيْنِ وَخَمْسِمِئَةِ أَلْف'],
    [5000000000, 'خَمْسَةِ مِلْيَارَات'],
  ])('reads %d as %s (genitive, masculine counted noun, no tanween)', (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  it('refuses what it can\'t read as a number', () => {
    expect(() => numberToWords(MAX_NUMBER + 1)).toThrow(RangeError);
    expect(() => numberToWords(-1)).toThrow(RangeError);
  });

  it('reads codes digit by digit, and accepts Arabic-Indic and Persian digits', () => {
    expect(readDigits('050')).toBe('صِفْر خَمْسَة صِفْر');
    expect(toWesternDigits('١٩٤٨ ۲۰')).toBe('1948 20');
  });

  it.each([
    ['1950،', ['أَلْف', 'وَتِسْعِمِئَة', 'وَخَمْسِينَ،']],
    ['٣', ['ثَلَاثَة']],
    ['وَ12', ['وَاثْنَيْ', 'عَشَرَ']],
    ['1,500', ['أَلْف', 'وَخَمْسِمِئَة']],
    ['١٬٥٠٠', ['أَلْف', 'وَخَمْسِمِئَة']],
    ['3.5', ['ثَلَاثَة', 'فَاصِلَة', 'خَمْسَة']],
    ['٢٫٠٥', ['اِثْنَيْنِ', 'فَاصِلَة', 'صِفْر', 'خَمْسَة']],
    ['50%', ['خَمْسِينَ', 'بِالمِئَةِ']],
    ['٥٠٪.', ['خَمْسِينَ', 'بِالمِئَةِ.']],
    ['0501234567', ['صِفْر', 'خَمْسَة', 'صِفْر', 'وَاحِد', 'اِثْنَان', 'ثَلَاثَة', 'أَرْبَعَة', 'خَمْسَة', 'سِتَّة', 'سَبْعَة']],
    ['كِتَاب', ['كِتَاب']],
  ])('turns the written word %s into spoken words', (word, spoken) => {
    expect(normalizeNumbersInWord(word)).toEqual(spoken);
  });

  it('keeps the word map: each spoken word knows its displayed word', () => {
    expect(normalizeForSpeech('عَامِ 1950، وَلَهُ ٣')).toEqual([
      { text: 'عَامِ', displayIndex: 0 },
      { text: 'أَلْف', displayIndex: 1 },
      { text: 'وَتِسْعِمِئَة', displayIndex: 1 },
      { text: 'وَخَمْسِينَ،', displayIndex: 1 },
      { text: 'وَلَهُ', displayIndex: 2 },
      { text: 'ثَلَاثَة', displayIndex: 3 },
    ]);
  });

  it('leaves the text as written when normalization is off (developer switch)', () => {
    expect(normalizeForSpeech('عَامِ 1950', { enabled: false })).toEqual([
      { text: 'عَامِ', displayIndex: 0 },
      { text: '1950', displayIndex: 1 },
    ]);
  });
});
