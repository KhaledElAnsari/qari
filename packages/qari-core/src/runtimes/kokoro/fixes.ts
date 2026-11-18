/**
 * Nabra's text and audio fixes on top of the reference pipeline (each found by ear and checked by measurement in the
 * nabra-onnx project; see its HANDOFF.md). Arabic marks are written as \u escapes: typed as characters they get
 * reordered by editors.
 */

// ── arabic_g2p.py (the reference pipeline) ────────────────────────────────────
const LATIN_RUN = /[A-Za-z]+/g;
/**
 * arabic_g2p.normalize_text for one spoken word: Latin letters make no sound. (Its citation removal, e.g. [12], is not
 * done: in qari numbers are already words by then, and the other voices read bracketed numbers too.)
 */
export function cleanWord(word: string): string {
  return word.replace(LATIN_RUN, '');
}

const PHONEME_FIXUPS: [string, string][] = [['̪', ''], ['ˤ', ''], ['[', ''], [']', ''], ['{', ''], ['}', '']];
const SYLLABLE_DOT = /(?<=\S)\.(?=\S)/gu;
/** arabic_g2p.clean_phonemes: drop espeak's syllable dots and the marks outside Kokoro's vocab. */
export function cleanPhonemes(phonemes: string): string {
  let out = phonemes.replace(SYLLABLE_DOT, '');
  for (const [from, to] of PHONEME_FIXUPS) out = out.split(from).join(to);
  return out;
}

// ── Shadda ────────────────────────────────────────────────────────────────────
/**
 * Unicode stores a short vowel before the shadda; espeak-ng's Arabic rules expect the shadda first and otherwise drop
 * the vowel: «إِنَّ» ʔinn, «مُحَمَّدٌ» muħammdun. Shadda first: ʔinna, muħammadun.
 */
export function shaddaFirst(text: string): string {
  return text.replace(/([\u064B-\u0650])\u0651/gu, '\u0651$1');
}

// ── «ال» after a prefix ───────────────────────────────────────────────────────
// espeak reads the article right only at the start of a word. After وَ فَ بِ كَ لِ it drops the lām or reads the silent
// alif aloud: «فَالوَقْتُ» fawaqtu, «بِالوَقْتِ» biaːluːaqti, «لِلوَقْتِ» liluːaqti, «بِالسُّوقِ» biaːssuːqi. Rewritten
// for espeak only, and only when the prefix has its vowel mark (bare text is left as it is):
//   moon letter: alif wasla + sukun on the lām (falwaqtu, bilwaqti); «لِل» + moon letter: sukun (lilwaqti);
//   sun letter after بِ / كَ: drop «ال», the shadda doubles the letter (bissuːqi); after وَ / فَ alone it is already right.
const MOON = '\u0621\u0622\u0623\u0625\u0627\u0628\u062C\u062D\u062E\u0639\u063A\u0641\u0642\u0643\u0645\u0647\u0648\u064A';
const SUN = '\u062A\u062B\u062F\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u0637\u0638\u0644\u0646';
const WORD_START = '(^|[^\\p{L}\\p{M}])';
const WA_FA = '(?:[\u0648\u0641]\u064E)?';
const BI_KA = '[\u0628\u0643][\u064E\u0650]';
const ARTICLE_MOON = new RegExp(`${WORD_START}(${WA_FA}(?:${BI_KA})?)\u0627\u0644\u0652?(?=[${MOON}])`, 'gu');
const LIL_MOON = new RegExp(`${WORD_START}(${WA_FA}\u0644\u0650\u0644)(?=[${MOON}])`, 'gu');
const BI_KA_SUN = new RegExp(`${WORD_START}(${WA_FA}${BI_KA})\u0627\u0644(?=[${SUN}])`, 'gu');
export function fixArticle(text: string): string {
  return text
    .replace(ARTICLE_MOON, (match, start: string, prefix: string) => (prefix ? `${start}${prefix}\u0671\u0644\u0652` : match))
    .replace(LIL_MOON, '$1$2\u0652')
    .replace(BI_KA_SUN, '$1$2');
}

// ── Tripled consonants ────────────────────────────────────────────────────────
/**
 * «ال» + sun letter + shadda gives the letter three times (assimilated lām + shadda): «السُّوقِ» ʔasssuːqi, «اللَّهُ»
 * ʔalllahu, or twice + a length mark: «الصَّبْرُ» ʔassːabru. Arabic has at most a double consonant.
 */
export function collapseGeminates(phonemes: string): string {
  return phonemes.replace(/([^aeiouAIOQWYɑːˈˌ\s.,;:!?…"()“”—])\1+(?:\1|ː)/gu, '$1$1');
}

// ── Emphatics ض ط ص ───────────────────────────────────────────────────────────
/**
 * espeak marks ض as dˤ and ط ص with a dental mark (t̪ s̪); ظ is a plain ð. clean_phonemes strips the marks, so the model
 * was trained with ض ط ص as د ت س. "dark" darkens the vowel next to them (a → ɑ), as emphatics do in Arabic; by ear it
 * fixes many words (a variant with retroflex ɖ ʈ ʂ sounded wrong). "plain" = the reference pipeline.
 */
export type EmphaticsMode = 'plain' | 'dark';
const MARKER = '\u0001';
export function markEmphatics(raw: string, mode: EmphaticsMode): string {
  if (mode !== 'dark') return raw;
  const chars = [...raw.replace(/([dts])(?:̪|ˤ)/gu, `$1${MARKER}`)];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== MARKER) continue;
    let after = i + 1;
    while (after < chars.length && (`ˈˌː.${MARKER}`.includes(chars[after]) || chars[after] === chars[i - 1])) after++;
    if (chars[after] === 'a') chars[after] = 'ɑ';
    let before = i - 2;
    while (before >= 0 && 'ˈˌː.'.includes(chars[before])) before--;
    if (chars[before] === 'a') chars[before] = 'ɑ';
  }
  return chars.join('').split(MARKER).join('');
}

// ── Breath before the first word ──────────────────────────────────────────────
/**
 * The model puts a learned inhale before every sentence (~100–150 ms; 160–225 ms before ه / ح, which are breathy
 * themselves), and pre-voices a soft first sound like و. Silences the samples before the first loud frame
 * (0.35 × the sentence's median speech level), never past the end of the leading pad token, with a 12.5 ms fade-in.
 * Nothing moves in time, so word timings stay exact. Returns the number of samples silenced.
 */
export function trimLeadingBreath(audio: Float32Array, padFrames: number, samplesPerFrame: number): number {
  const frames = Math.floor(audio.length / samplesPerFrame);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * samplesPerFrame; i < (f + 1) * samplesPerFrame; i++) sum += audio[i] * audio[i];
    rms[f] = Math.sqrt(sum / samplesPerFrame);
  }
  const loud = Array.from(rms).filter(level => level > 0.02).sort((a, b) => a - b);
  if (loud.length === 0) return 0;
  const threshold = 0.35 * loud[Math.floor(loud.length / 2)];
  let onset = 0;
  while (onset < frames && rms[onset] <= threshold) onset++;
  const keepFrom = Math.min(onset, padFrames) * samplesPerFrame;
  if (keepFrom <= 0) return 0;
  const fade = Math.min(samplesPerFrame >> 1, keepFrom);
  const silenceEnd = keepFrom - fade;
  audio.fill(0, 0, silenceEnd);
  for (let i = 0; i < fade; i++) audio[silenceEnd + i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
  return silenceEnd;
}
