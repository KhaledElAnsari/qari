import golden from './fixtures/g2p-golden.json';
import { NabraG2P, tokenize } from './g2p';
import type { Espeak } from './g2p';

/** Replays the answers Python's espeak-ng gave for each piece of text (fixtures: nabra-onnx/export/make_qari_fixture.py). */
const recordedEspeak: Espeak = {
  phonemize(text) {
    const answer = (golden.espeak as Record<string, string>)[text];
    if (answer === undefined) throw new Error(`no recorded espeak answer for ${JSON.stringify(text)}`);
    return answer;
  },
};
const g2p = new NabraG2P(recordedEspeak);

describe('Nabra G2P (port of misaki + phonemizer + arabic_g2p)', () => {
  it.each(golden.sentences.map(row => [row.text, row.phonemes]))('gives Python\'s phonemes for %s', (text, phonemes) => {
    expect(g2p.phonemize(text)).toBe(phonemes);
  });

  it('gives Python\'s phonemes for every word of the corpus', () => {
    for (const [word, phonemes] of Object.entries(golden.words)) expect([word, g2p.phonemize(word)]).toEqual([word, phonemes]);
  });

  it('maps every phoneme to its word, a number to all of its spoken words', () => {
    const { phonemes, words, wordOf, aligned } = g2p.phonemizeWithWords('وُلِدَ فِي عَامِ ١٩٨٥ فِي مَدِينَةِ القَاهِرَةِ.');
    expect(aligned).toBe('per-word');
    const of = (word: number) => [...phonemes].filter((_, i) => wordOf[i] === word).join('');
    expect(words[3]).toBe('١٩٨٥');
    expect(of(3)).toBe('ʔˈalfwatˈisʕʕˌumiʔˌawaxˈamsawˌaθamaːnˈuːn');
    expect(of(6)).toBe('ʔalqaːhˈiratˌi');
  });

  it('tokenizes like KModel.forward: pads at both ends, characters outside the vocab dropped', () => {
    const { ids, wordOfToken } = tokenize('ʕa x', { 'ʕ': 7, 'a': 43, ' ': 16 }, Int32Array.from([0, 0, -1, 1]));
    expect(ids).toEqual([0, 7, 43, 16, 0]);
    expect(wordOfToken).toEqual([-1, 0, 0, -1, -1]);
  });
});
