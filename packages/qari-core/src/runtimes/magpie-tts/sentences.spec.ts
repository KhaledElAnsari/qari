import { groupSentences } from './sentences';

const words = (text: string) => text.split(' ');

describe('Bayan sentence grouping', () => {
  it('reads one sentence per take and keeps every word index', () => {
    expect(groupSentences(words('إِنَّ الْعِلْمَ نُورٌ. وَالْكِتَابُ خَيْرُ جَلِيسٍ؟ نعم!'))).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });

  it('ends a sentence at a line break, and keeps a last sentence with no full stop', () => {
    expect(groupSentences(words('سطر أول سطر ثان'), 180, [false, true, false, false])).toEqual([[0, 1], [2, 3]]);
  });

  it('splits a long sentence by clause, then by word, never inside a word', () => {
    const clause = Array<string>(30).fill('كلمة');
    clause[29] = 'كلمة،';
    expect(groupSentences([...clause, ...Array<string>(30).fill('كلمة')], 180)).toHaveLength(2);
    const long = groupSentences(Array<string>(60).fill('كلمة'), 100);
    expect(long.length).toBeGreaterThan(2);
    expect(long.flat()).toEqual(Array.from({ length: 60 }, (_, i) => i));
  });
});
