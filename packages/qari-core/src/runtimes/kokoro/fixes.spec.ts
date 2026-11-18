import { cleanWord, collapseGeminates, fixArticle, markEmphatics, shaddaFirst, trimLeadingBreath } from './fixes';

describe('Nabra fixes', () => {
  it('drops Latin letters from a word', () => {
    expect(cleanWord('Google')).toBe('');
    expect(cleanWord('قَلَمٌ')).toBe('قَلَمٌ');
  });

  it('puts the shadda before its vowel', () => {
    // Escaped: typed as characters, the marks get reordered. إِنَّ: nūn + fatha + shadda → nūn + shadda + fatha.
    expect(shaddaFirst('\u0625\u0650\u0646\u064E\u0651')).toBe('\u0625\u0650\u0646\u0651\u064E');
    // رَبِّ: bā + kasra + shadda → bā + shadda + kasra.
    expect(shaddaFirst('\u0631\u064E\u0628\u0650\u0651')).toBe('\u0631\u064E\u0628\u0651\u0650');
    expect(shaddaFirst('\u0643\u064E\u062A\u064E\u0628\u064E')).toBe('\u0643\u064E\u062A\u064E\u0628\u064E');
  });

  it('fixes «ال» after a prefix, only when the prefix has its vowel mark', () => {
    expect(fixArticle('فَالوَقْتُ')).toBe('فَٱلْوَقْتُ');
    expect(fixArticle('بِالوَقْتِ')).toBe('بِٱلْوَقْتِ');
    expect(fixArticle('لِلوَقْتِ')).toBe('لِلْوَقْتِ');
    expect(fixArticle('بِالسُّوقِ')).toBe('بِسُّوقِ');
    // Left alone: no prefix (already right), وَ/فَ + sun letter (already right), bare text, a word that isn't the article.
    for (const text of ['الوَقْتُ', 'فَالشَّمْسُ', 'فالوقت', 'مُكَالَمَةٌ']) expect(fixArticle(text)).toBe(text);
  });

  it('collapses a tripled consonant to a double one', () => {
    expect(collapseGeminates('ʔasssˈuːqi')).toBe('ʔassˈuːqi');
    expect(collapseGeminates('ʔassːˈabru')).toBe('ʔassˈabru');
    expect(collapseGeminates('ʔatːˈaːlibˌu')).toBe('ʔatːˈaːlibˌu');
    expect(collapseGeminates('ʔinna')).toBe('ʔinna');
  });

  it('darkens the vowel next to ض ط ص, and leaves «plain» unchanged', () => {
    expect(markEmphatics('dˤˈa.rabˌa', 'dark')).toBe('dˈɑ.rabˌa');
    expect(markEmphatics('t̪ˈa.ːba', 'dark')).toBe('tˈɑ.ːba');
    expect(markEmphatics('dˈa.rabˌa', 'dark')).toBe('dˈa.rabˌa');
    expect(markEmphatics('dˤˈa.rabˌa', 'plain')).toBe('dˤˈa.rabˌa');
  });

  it('silences the breath before the first loud frame, never past the pad token', () => {
    const frame = 600;
    const audio = new Float32Array(20 * frame);
    for (let i = 0; i < 6 * frame; i++) audio[i] = 0.01 * Math.sin(i); // breath
    for (let i = 8 * frame; i < 20 * frame; i++) audio[i] = 0.3 * Math.sin(i / 3); // speech from frame 8
    const silenced = trimLeadingBreath(audio, 10, frame);
    expect(silenced).toBe(8 * frame - frame / 2);
    expect(audio.subarray(0, silenced).every(sample => sample === 0)).toBe(true);
    expect(audio[9 * frame]).not.toBe(0);
    // Speech from the very start: nothing is cut.
    const loud = new Float32Array(10 * frame).map((_, i) => 0.3 * Math.sin(i / 3));
    expect(trimLeadingBreath(loud, 10, frame)).toBe(0);
  });
});
