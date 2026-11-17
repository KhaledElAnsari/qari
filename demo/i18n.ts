/**
 * The demo's interface language: Arabic (right to left) or English (left to right). The text being read, the reading
 * view and the timing ribbon stay right to left whatever the interface language, because their content is Arabic.
 * The developer section stays in English.
 */
export type Locale = 'ar' | 'en';

const STRINGS = {
  ar: {
    badge: 'تجربة',
    tagline: 'الصق نصًّا عربيًّا واستمع إليه، والقراءة كلّها على جهازك.',
    textHeading: 'النص',
    diacriticsHint: 'النص المشكول يُقرأ أوضح.',
    samplesLabel: 'نصوص للتجربة',
    sampleGreeting: 'مثال: تحية',
    sampleNumbers: 'مثال: أرقام',
    readNumbers: 'اقرأ الأرقام',
    numbersNote: 'قراءة الأرقام آليًا ليست دقيقة 100%، فيمكنك إيقافها وكتابة الأرقام بالكلمات بنفسك.',
    voiceHeading: 'الصوت',
    quality: 'الجودة',
    qualityMedium: 'متوسطة',
    qualityHigh: 'عالية',
    chooseVoice: 'اختر صوتًا',
    mode: 'طريقة التشغيل',
    prepare: 'جهّز الصوت',
    generationNote: 'يتم توليد المقطع الصوتي على جهازك مباشرةً، وقد يستغرق ذلك بعض الوقت، خاصةً في المرة الأولى.',
    playerHeading: 'المشغّل',
    read: '▶ اقرأ',
    stop: '■ أوقف',
    timingHeading: 'التوقيت',
    timingEmpty: 'جهّز الصوت لترى متى تُنطق كل كلمة.',
    makingAudio: 'جارٍ تجهيز الصوت…',
    statWords: 'الكلمات',
    statLength: 'المدة',
    statPace: 'السرعة',
    statPauses: 'الوقفات',
    tipScroll: 'مرّر الشريط جانبًا لترى كل الكلمات.',
    tipHover: 'مرّر المؤشر على كلمة لترى توقيتها بالضبط.',
    tipClick: 'انقر على كلمة ليبدأ الصوت منها.',
    downloadHeading: 'التحميل',
    download: '⬇ حمّل الصوت',
    keepNote: 'الصوت لا يُحفظ: يختفي عند تحديث الصفحة أو إغلاقها ما لم تحمّله.',
    developers: 'للمطوّرين',
    notAvailableHere: 'غير متاح على هذا الجهاز',
    notLoaded: 'لم يُجهَّز بعد',
    preparing: 'جارٍ التجهيز…',
    warming: 'لحظات أخيرة…',
    changed: 'تغيّر شيء · جهّز الصوت مرة أخرى',
    noAudioYet: 'لا يوجد صوت بعد',
    ready: 'جاهز',
    fromCache: 'من الذاكرة',
    downloading: 'جارٍ التنزيل',
    seconds: 'ث',
    wpm: 'كلمة/دقيقة',
    mono: 'أحادي',
    'state.loading': 'يُجهَّز',
    'state.warming': 'يُجهَّز',
    'state.ready': 'جاهز',
    'state.playing': 'يقرأ',
    'state.paused': 'متوقف مؤقتًا',
    switchTo: 'English',
    switchToLabel: 'Switch the interface to English',
  },
  en: {
    badge: 'demo',
    tagline: 'Paste Arabic text and hear it read aloud, entirely on your device.',
    textHeading: 'Text',
    diacriticsHint: 'Diacritized text is read more accurately.',
    samplesLabel: 'Sample texts',
    sampleGreeting: 'Sample: greeting',
    sampleNumbers: 'Sample: numbers',
    readNumbers: 'Read numbers',
    numbersNote: 'Reading numbers automatically isn\'t 100% accurate: you can turn it off and write the numbers as words yourself.',
    voiceHeading: 'Voice',
    quality: 'Quality',
    qualityMedium: 'Medium',
    qualityHigh: 'High',
    chooseVoice: 'Choose a voice',
    mode: 'Mode',
    prepare: 'Prepare audio',
    generationNote: 'The audio is generated right on your device, so it may take some time, especially the first time.',
    playerHeading: 'Player',
    read: '▶ Read',
    stop: '■ Stop',
    timingHeading: 'Timing',
    timingEmpty: 'Prepare the audio to see when each word is spoken.',
    makingAudio: 'Making the audio…',
    statWords: 'Words',
    statLength: 'Length',
    statPace: 'Pace',
    statPauses: 'Pauses',
    tipScroll: 'Scroll the ribbon sideways to see all the words.',
    tipHover: 'Hover over a word to see its exact timing.',
    tipClick: 'Click a word to play the audio from there.',
    downloadHeading: 'Download',
    download: '⬇ Download audio',
    keepNote: 'The audio isn\'t saved: it\'s gone when you refresh or close the tab, unless you download it.',
    developers: 'For developers',
    notAvailableHere: 'Not available on this device',
    notLoaded: 'Not loaded',
    preparing: 'Preparing…',
    warming: 'Warming up…',
    changed: 'Changed · prepare the audio again',
    noAudioYet: 'No audio yet',
    ready: 'Ready',
    fromCache: 'From cache',
    downloading: 'Downloading',
    seconds: 's',
    wpm: 'wpm',
    mono: 'mono',
    'state.loading': 'loading',
    'state.warming': 'warming',
    'state.ready': 'ready',
    'state.playing': 'playing',
    'state.paused': 'paused',
    switchTo: 'العربية',
    switchToLabel: 'غيّر لغة الواجهة إلى العربية',
  },
} as const;

export type StringKey = keyof typeof STRINGS.en;

const STORAGE_KEY = 'qari-demo-locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  }
  catch {
    // Storage blocked (private mode, sandbox): fall back to the browser's language.
  }
  return navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

let current: Locale = initialLocale();

export const locale = (): Locale => current;

/** The interface text for a key, in the current language. */
export const t = (key: StringKey): string => STRINGS[current][key];

/** Arabic or English, picked from a { ar, en } pair (voice labels, mode labels, error messages). */
export const pick = (text: { ar: string; en: string }): string => text[current];

/** Sets the page language and direction, and fills every element marked with data-i18n (or data-i18n-label). */
export function applyLocale(next: Locale = current): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  }
  catch {
    // Not remembered across visits; the page still switches.
  }
  document.documentElement.lang = next;
  document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) element.textContent = t(element.dataset.i18n as StringKey);
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) element.setAttribute('aria-label', t(element.dataset.i18nLabel as StringKey));
  // Step numbers in the interface's digits: ١ ٢ ٣ ٤ or 1 2 3 4.
  document.querySelectorAll<HTMLElement>('.step').forEach((step, index) => {
    step.textContent = next === 'ar' ? '١٢٣٤٥٦٧٨٩'[index] : String(index + 1);
  });
}
