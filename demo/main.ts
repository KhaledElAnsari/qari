/**
 * Demo: prepare Male/Female sound in default or accelerated mode, read a sentence. `?voice-base=<path>` loads configs from
 * another folder on this same site (the browser tests use it); other sites are ignored, so a link can't point the demo at
 * someone else's files.
 * Also checks that the model files are on the server and can clear the saved voice files (OPFS).
 */
import { clearVoiceCache, createReader, encodeWav, splitDisplayWords, loadVoiceConfig, MODE_LABELS, probeDevice, QariError } from '@khaledelansari/qari-core';
import type { Backend, LoadProgress, Reader, ReaderState, Synthesis, VoiceConfig, WordTimings } from '@khaledelansari/qari-core';
import { applyLocale, locale, pick, t } from './i18n';
import '@khaledelansari/qari-element';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MEGABYTE = 1024 * 1024;
const requestedBase = new URL(new URLSearchParams(location.search).get('voice-base') ?? './', location.href);
const voiceBase = requestedBase.origin === location.origin ? requestedBase : new URL('./', location.href);

const elements = {
  probe: $('probe'),
  isolated: $('isolated'),
  voices: $('voices'),
  modeTrigger: $<HTMLButtonElement>('mode-trigger'),
  modeValue: $('mode-value'),
  modeList: $('mode-list'),
  prepare: $<HTMLButtonElement>('prepare'),
  progress: $<HTMLProgressElement>('progress'),
  stage: $('stage'),
  message: $('message'),
  text: $<HTMLTextAreaElement>('text'),
  normalize: $<HTMLInputElement>('normalize'),
  play: $<HTMLButtonElement>('play'),
  stop: $<HTMLButtonElement>('stop'),
  playback: $('playback'),
  reading: $('reading'),
  timingEmpty: $('timing-empty'),
  timingLoading: $('timing-loading'),
  timeline: $('timeline'),
  track: $('track'),
  ribbonScroll: $('ribbon-scroll'),
  ribbon: $('ribbon'),
  playhead: $('playhead'),
  ticks: $('ticks'),
  readout: $('readout'),
  statWords: $('stat-words'),
  statLength: $('stat-length'),
  statPace: $('stat-pace'),
  statPauses: $('stat-pauses'),
  timingJson: $('timing-json'),
  locale: $<HTMLButtonElement>('locale'),
  clock: $('clock'),
  download: $<HTMLButtonElement>('download'),
  fileInfo: $('file-info'),
  log: $('log'),
  filesNotice: $('files-notice'),
  clearCache: $<HTMLButtonElement>('clear-cache'),
  cacheStatus: $('cache-status'),
};

let voices: VoiceConfig[] = [];
let reader: Reader | null = null;
/** Timings of the last reading, and its ribbon segments by display word. */
let timings: WordTimings | null = null;
let segments = new Map<number, HTMLElement>();
/** Set when the listener presses Stop, so the clock isn't moved to the end. */
let stoppedByListener = false;
/** Last playback state, so its label can be redrawn in another language. */
let playbackState: ReaderState | null = null;
/** The prepared audio for the current text, voice and mode; Read plays it. Null until Prepare audio, or after a change. */
let audio: Synthesis | null = null;
/** True while the model is loading or reloading (Prepare audio, a voice or mode switch, clearing saved files). */
let modelBusy = false;

const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/** Read and Download are available only when there is prepared audio and the model isn't busy. */
function updateAudioControls(): void {
  const unavailable = modelBusy || audio === null;
  elements.play.disabled = unavailable;
  elements.download.disabled = unavailable;
  elements.fileInfo.textContent = audio
    // Each Latin piece isolated (U+2068 … U+2069), so Arabic text around it doesn't reorder "204 KB" or "22.05 kHz".
    ? [`${(audio.pcm.length / audio.sampleRate).toFixed(1)} ${t('seconds')}`, 'WAV', `${audio.sampleRate / 1000} kHz`, t('mono'), fileSize(44 + audio.pcm.length * 2)]
      .map(part => `\u2068${part}\u2069`).join(' · ')
    : t('noAudioYet');
}

/** Saves the prepared audio as a WAV file. It exists only in this page's memory, so this is the only way to keep it. */
function downloadAudio(): void {
  if (!audio || !reader) return;
  const blob = new Blob([encodeWav(audio.pcm, audio.sampleRate)], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const link = Object.assign(document.createElement('a'), { href: url, download: `qari-${stamp}.wav` });
  document.body.append(link);
  link.click();
  link.remove();
  // Let the browser start the download before the in-memory file is released.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  log(`downloaded ${link.download} (${fileSize(blob.size)})`);
}

/** While the model works, every control waits: text, voice, mode, Prepare audio, Read and the cache button. */
function setModelBusy(busy: boolean): void {
  modelBusy = busy;
  if (busy) closeModeList(false);
  elements.text.disabled = busy;
  elements.normalize.disabled = busy;
  elements.modeTrigger.disabled = busy;
  elements.prepare.disabled = busy;
  elements.clearCache.disabled = busy;
  for (const radio of elements.voices.querySelectorAll('input')) radio.disabled = busy;
  for (const sample of document.querySelectorAll<HTMLButtonElement>('.sample')) sample.disabled = busy;
  elements.voices.setAttribute('aria-disabled', String(busy));
  document.body.toggleAttribute('data-model-busy', busy);
  updateAudioControls();
}

const log = (line: string) => {
  elements.log.textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
};

const megabytes = (bytes: number) => (bytes / MEGABYTE).toFixed(1);
const MODES: readonly Backend[] = ['wasm', 'webgpu'];
let mode: Backend = 'wasm';
const selectedMode = () => mode;

/** Shows a mode as chosen in the list and on its trigger (without switching the reader). */
function showMode(next: Backend): void {
  mode = next;
  elements.modeValue.textContent = pick(MODE_LABELS[next]);
  for (const option of modeOptions()) option.setAttribute('aria-selected', String(option.dataset.value === next));
}

const modeOptions = () => [...elements.modeList.querySelectorAll<HTMLElement>('[role="option"]')];
const isModeListOpen = () => elements.modeList.hasAttribute('data-open');

function setActiveOption(index: number): void {
  const options = modeOptions();
  const active = options[(index + options.length) % options.length];
  for (const option of options) option.classList.toggle('active', option === active);
  elements.modeList.setAttribute('aria-activedescendant', active.id);
}

/** Opens the list on the chosen mode; from the keyboard it appears at once (no animation on keyboard actions). */
function openModeList(fromKeyboard: boolean): void {
  elements.modeList.toggleAttribute('data-instant', fromKeyboard);
  elements.modeList.setAttribute('data-open', '');
  elements.modeTrigger.setAttribute('aria-expanded', 'true');
  setActiveOption(MODES.indexOf(mode));
  elements.modeList.focus();
}

function closeModeList(returnFocus: boolean): void {
  if (!isModeListOpen()) return;
  elements.modeList.removeAttribute('data-open');
  elements.modeTrigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) elements.modeTrigger.focus();
}

function chooseMode(next: Backend): void {
  closeModeList(true);
  if (next === mode) return;
  showMode(next);
  discardAudio();
}

/** The mode list: a custom listbox in the page's style; labels come from MODE_LABELS, the engine's single source for them. */
function buildModeList(): void {
  for (const value of MODES) {
    const option = document.createElement('li');
    option.id = `mode-${value}`;
    option.setAttribute('role', 'option');
    option.dataset.value = value;
    option.append(
      Object.assign(document.createElement('span'), { className: 'label', textContent: pick(MODE_LABELS[value]) }),
      Object.assign(document.createElement('span'), { className: 'check', textContent: '✓' }),
    );
    option.querySelector('.check')?.setAttribute('aria-hidden', 'true');
    option.addEventListener('click', () => chooseMode(value));
    option.addEventListener('pointermove', () => setActiveOption(MODES.indexOf(value)));
    elements.modeList.append(option);
  }
  showMode('wasm');

  elements.modeTrigger.addEventListener('click', (event) => {
    if (isModeListOpen()) closeModeList(true);
    else openModeList(event.detail === 0); // detail 0: Enter or Space, not a pointer
  });
  elements.modeTrigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openModeList(true);
  });
  elements.modeList.addEventListener('keydown', (event) => {
    const active = modeOptions().findIndex(option => option.classList.contains('active'));
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: MODES.length - 1 };
    if (event.key in moves) setActiveOption(moves[event.key]);
    else if (event.key === 'Enter' || event.key === ' ') chooseMode(MODES[active]);
    else if (event.key === 'Escape') closeModeList(true);
    else if (event.key === 'Tab') closeModeList(false);
    else return;
    if (event.key !== 'Tab') event.preventDefault();
  });
  document.addEventListener('pointerdown', (event) => {
    if (isModeListOpen() && !(event.target as Element).closest('.select')) closeModeList(false);
  });
}

const readyText = (activeReader: Reader) => `${t('ready')} · ${pick(activeReader.voice.label)} · ${pick(MODE_LABELS[activeReader.backend])}`;

/** The status line keeps how it was made, so switching language redraws it in the new one. */
let stageText: () => string = () => t('notLoaded');
function setStage(render: () => string): void {
  stageText = render;
  elements.stage.textContent = render();
}

/** The error on screen, so one reported both as an event and as a rejection is shown once. */
let lastShownError: unknown = null;

/** Listeners see only the friendly text; the technical detail goes to the developer log. */
function showError(error: unknown): void {
  if (error === lastShownError && !elements.message.hidden) return;
  lastShownError = error;
  const qariError = error instanceof QariError ? error : new QariError('unexpected', String(error));
  elements.message.textContent = pick(qariError.text);
  elements.message.hidden = false;
  log(`error ${qariError.code}: ${qariError.detail ?? ''}`);
  if (qariError.code === 'voice-unavailable') void explainUnavailableVoice();
}

const clearError = () => {
  elements.message.hidden = true;
  elements.filesNotice.hidden = true;
};

/** Model URLs of every listed voice, once each. */
function modelUrls(): string[] {
  const urls = voices.flatMap(voice => [voice.model.url, voice.vocoder?.url]);
  return [...new Set(urls.filter((url): url is string => Boolean(url)).map(url => new URL(url, voiceBase).href))];
}

/**
 * Asks the server for each model file without downloading it. Dev servers and SPA hosts answer a missing file with
 * their index page, so an HTML answer counts as missing too. Servers that refuse HEAD are given the benefit of the doubt.
 */
async function missingModelFiles(): Promise<string[]> {
  const results = await Promise.all(modelUrls().map(async (url) => {
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      const isPage = response.headers.get('content-type')?.toLowerCase().includes('text/html') ?? false;
      return response.status === 404 || response.status === 410 || (response.ok && isPage) ? url : null;
    }
    catch {
      return null;
    }
  }));
  return results.filter((url): url is string => url !== null);
}

/** Developer note on the page: which files are missing, and how to get them. */
function showMissingFiles(missing: string[]): void {
  const names = missing.map(url => decodeURIComponent(url.split('/').pop() ?? url));
  for (const url of missing) log(`model file missing on the server: ${url}`);
  const list = Object.assign(document.createElement('p'), { textContent: `Missing voice files: ${names.join(', ')}.` });
  const fix = document.createElement('p');
  fix.innerHTML = 'Put them in <code>voices/models/</code> (see <code>voices/models/README.md</code>), or run <code>npm run fetch-models</code>, then press Prepare audio again.';
  elements.filesNotice.replaceChildren(list, fix);
  elements.filesNotice.hidden = false;
}

/** After "voice unavailable": either the files are missing, or this browser saved a broken copy earlier. */
async function explainUnavailableVoice(): Promise<void> {
  const missing = await missingModelFiles();
  if (missing.length > 0) {
    showMissingFiles(missing);
    return;
  }
  const note = Object.assign(document.createElement('p'), { textContent: 'The voice files are on the server, so this browser may have saved a broken copy earlier (for example, from before the files were added).' });
  const button = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Clear saved voice files and prepare again' });
  button.addEventListener('click', () => void clearCache().then(async (cleared) => {
    if (cleared) await prepare();
  }));
  elements.filesNotice.replaceChildren(note, button);
  elements.filesNotice.hidden = false;
}

/** Deletes the saved voice files; the reader is closed first so its Worker lets go of them. Resolves true when cleared. */
async function clearCache(): Promise<boolean> {
  setModelBusy(true);
  try {
    await reader?.dispose();
    reader = null;
    elements.progress.value = 0;
    setStage(() => t('notLoaded'));
    setPhase('idle');
    audio = null;
    showTimingEmpty();
    const cleared = await clearVoiceCache();
    elements.cacheStatus.textContent = cleared ? 'Deleted. The next prepare downloads the voice again.' : 'This browser can\'t save voice files here, so there is nothing to delete.';
    log(cleared ? 'saved voice files deleted' : 'no voice cache (OPFS unavailable)');
    return cleared;
  }
  catch (error) {
    showError(error);
    return false;
  }
  finally {
    setModelBusy(false);
  }
}

type Phase = 'idle' | 'downloading' | 'preparing' | 'ready';

/** Drives the design: the Prepare button fills as its own download bar, and the status dot turns green when ready. */
function setPhase(phase: Phase, fraction = 0): void {
  elements.prepare.dataset.phase = phase;
  elements.prepare.setAttribute('aria-busy', String(phase === 'downloading' || phase === 'preparing'));
  elements.prepare.style.setProperty('--p', String(phase === 'idle' ? 0 : phase === 'downloading' ? Math.min(Math.max(fraction, 0), 1) : 1));
  elements.stage.toggleAttribute('data-ready', phase === 'ready');
}

function showProgress(progress: LoadProgress): void {
  if (progress.stage === 'downloading') {
    setPhase('downloading', progress.totalBytes > 0 ? progress.loadedBytes / progress.totalBytes : 0);
    elements.progress.max = Math.max(progress.totalBytes, 1);
    elements.progress.value = progress.loadedBytes;
    const total = progress.totalBytes > 0 ? ` / ${megabytes(progress.totalBytes)}` : '';
    setStage(() => progress.fromCache
      ? `${t('fromCache')} (${megabytes(progress.loadedBytes)} MB)`
      : `${t('downloading')} ${megabytes(progress.loadedBytes)}${total} MB`);
    return;
  }
  elements.progress.removeAttribute('value');
  setPhase('preparing');
  setStage(() => t(progress.stage === 'preparing' ? 'preparing' : 'warming'));
}

/** The selected voice, exactly as its config describes it (model files come only from the configs). */
function selectedVoice(): VoiceConfig {
  const id = (document.querySelector<HTMLInputElement>('input[name="voice"]:checked'))?.value;
  return voices.find(candidate => candidate.id === id) ?? voices[0];
}

async function loadVoices(): Promise<void> {
  const index = await (await fetch(new URL('index.json', voiceBase))).json() as string[];
  voices = await Promise.all(index.map(file => loadVoiceConfig(new URL(file, voiceBase))));
  const defaultVoice = voices.find(voice => voice.isDefault) ?? voices[0];
  for (const voice of voices) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="voice" value="${voice.id}"><span class="label"></span>`;
    (label.querySelector('.label') as HTMLElement).textContent = pick(voice.label);
    const radio = label.querySelector('input') as HTMLInputElement;
    radio.checked = voice === defaultVoice;
    radio.addEventListener('change', discardAudio);
    elements.voices.append(label);
  }
  elements.voices.style.setProperty('--n', String(voices.length));
  const missing = await missingModelFiles();
  if (missing.length > 0) showMissingFiles(missing);
}

/** Listens to a new reader: progress, problems, playback state, and the timings of what plays. */
function attachReaderListeners(activeReader: Reader): void {
  activeReader.on('progress', showProgress);
  activeReader.on('warning', message => log(`warning: ${message}`));
  activeReader.on('error', showError);
  activeReader.on('state', (state) => {
    playbackState = state;
    elements.playback.textContent = t(`state.${state}`);
    document.body.dataset.playback = state;
  });
  activeReader.on('timings', (next) => {
    renderTimeline(next);
    followPlayhead();
  });
}

const sameVoice = (a: VoiceConfig, b: VoiceConfig) => a.id === b.id && a.model.url === b.model.url && a.vocoder?.url === b.vocoder?.url;

/**
 * Gets the reader to the chosen voice and mode: loads it the first time, otherwise switches only what changed
 * (Male ↔ Female sound reuse the same model files, so no download).
 */
async function loadSelectedVoice(): Promise<Reader> {
  const voice = selectedVoice();
  const backend = selectedMode();
  const startedAt = performance.now();
  if (!reader) {
    reader = await createReader({ voice, backend });
    attachReaderListeners(reader);
    log(`voice ${reader.voice.id} ready in ${Math.round(performance.now() - startedAt)} ms on ${reader.backend}`);
    return reader;
  }
  if (!sameVoice(reader.voice, voice)) {
    await reader.setVoice(voice);
    log(`switched to ${reader.voice.id} in ${Math.round(performance.now() - startedAt)} ms`);
  }
  if (reader.backend !== backend) {
    try {
      await reader.setBackend(backend);
      log(`now in ${reader.backend}`);
    }
    catch {
      // Already shown through the error event (plain words); the reader went back to the mode it had, so carry on in it.
      showMode(reader.backend);
    }
  }
  return reader;
}

/**
 * Prepare audio: loads or switches the voice as chosen, then makes the audio for the text and draws its timings.
 * Read plays exactly this audio; changing the text, voice or mode discards it until Prepare audio runs again.
 */
async function prepare(): Promise<void> {
  setModelBusy(true);
  clearError();
  discardAudio();
  setStage(() => t('preparing'));
  setPhase('downloading', 0);
  try {
    const activeReader = await loadSelectedVoice();
    setPhase('preparing');
    await makeAudio(activeReader);
    elements.progress.max = 1;
    elements.progress.value = 1;
    setStage(() => readyText(activeReader));
    setPhase('ready');
  }
  catch (error) {
    // A failed switch leaves the reader as it was (e.g. accelerated mode falls back to default): show that.
    if (reader) showMode(reader.backend);
    setStage(() => t(reader ? 'noAudioYet' : 'notLoaded'));
    setPhase('idle');
    showError(error);
  }
  finally {
    setModelBusy(false);
  }
}

const secondsText = (value: number) => `${value.toFixed(2)} ${t('seconds')}`;

/** Player clock: time heard / total length. */
const setClock = (position: number, total: number) => {
  elements.clock.textContent = `${position.toFixed(1)} / ${total.toFixed(1)} ${t('seconds')}`;
};

function setStat(element: HTMLElement, value: string, unit: string): void {
  element.replaceChildren(value, Object.assign(document.createElement('small'), { textContent: unit }));
}

/** Shows one word's timing under the ribbon. */
function describeWord(word: { text: string; start: number; end: number }): void {
  elements.readout.replaceChildren(
    Object.assign(document.createElement('b'), { textContent: word.text, lang: 'ar' }),
    '  ',
    Object.assign(document.createElement('span'), {
      textContent: `${secondsText(word.start)} → ${secondsText(word.end)} · ${Math.round((word.end - word.start) * 1000)} ms`,
      dir: 'ltr',
    }),
  );
}

/** Hides a segment's label when the word doesn't fit (narrow screens, short words); hovering still names it. */
function fitLabels(): void {
  for (const segment of segments.values()) {
    segment.classList.remove('tight');
    segment.classList.toggle('tight', segment.scrollWidth > segment.clientWidth + 1);
  }
}

/** Back to the empty timing card (no audio for this text yet). */
function showTimingEmpty(): void {
  timings = null;
  segments = new Map();
  elements.timeline.hidden = true;
  elements.timingEmpty.hidden = false;
  elements.clock.textContent = '– / –';
}

/** Makes the audio for the current text, without playing it, and draws its timings. */
async function makeAudio(activeReader: Reader): Promise<void> {
  const text = elements.text.value;
  if (text.trim() === '') {
    showTimingEmpty();
    return;
  }
  // Only show the loader if the work takes a moment, so quick runs don't flash.
  const showLoader = window.setTimeout(() => setTimingBusy(true), 150);
  try {
    audio = await activeReader.synthesize(text, { normalize: elements.normalize.checked });
    if (audio.timings) renderTimeline(audio.timings);
    else showTimingEmpty();
  }
  catch (error) {
    showTimingEmpty();
    throw error;
  }
  finally {
    clearTimeout(showLoader);
    setTimingBusy(false);
  }
}

/** The text, voice or mode changed: the prepared audio no longer matches, so it goes until Prepare audio runs again. */
function discardAudio(): void {
  const hadAudio = audio !== null;
  audio = null;
  showTimingEmpty();
  if (reader && hadAudio) {
    setPhase('idle');
    setStage(() => t('changed'));
  }
  updateAudioControls();
}

/** Loader while the audio for the text is made: a placeholder ribbon at first, or a dimmed ribbon once one exists. */
function setTimingBusy(busy: boolean): void {
  const hasRibbon = !elements.timeline.hidden;
  elements.timeline.toggleAttribute('data-busy', busy);
  elements.timingLoading.classList.toggle('compact', hasRibbon);
  elements.timingLoading.hidden = !busy;
  if (!hasRibbon) elements.timingEmpty.hidden = busy;
}

/** Draws the ribbon: one segment per heard word, placed and sized by its time; the gaps are pauses. */
function renderTimeline(next: WordTimings): void {
  if (next === timings) {
    // The same audio again (Read after Prepare audio, or a replay): just rewind the ribbon.
    for (const segment of segments.values()) segment.classList.remove('read', 'current');
    elements.playhead.style.transform = 'translateX(0)';
    setClock(0, next.duration);
    return;
  }
  timings = next;
  const total = Math.max(next.duration, 0.001);
  const percent = (value: number) => `${(value / total) * 100}%`;
  const heard = next.displayWords.filter(word => word.end > word.start);
  segments = new Map();
  const nodes = heard.map((word, order) => {
    const segment = Object.assign(document.createElement('span'), { className: 'seg', textContent: word.text, tabIndex: 0, lang: 'ar' });
    segment.style.insetInlineStart = percent(word.start);
    segment.style.width = percent(word.end - word.start);
    segment.style.setProperty('--i', String(Math.min(order, 16)));
    segment.setAttribute('role', 'button');
    segment.setAttribute('aria-label', `${word.text}: ${secondsText(word.start)} to ${secondsText(word.end)}. Play from here`);
    for (const type of ['pointerenter', 'focus']) segment.addEventListener(type, () => describeWord(word));
    segment.addEventListener('click', () => playFromWord(word.start));
    segment.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      playFromWord(word.start);
    });
    segments.set(word.displayIndex, segment);
    return segment;
  });
  elements.playhead.style.transform = 'translateX(0)';
  elements.track.replaceChildren(elements.playhead, ...nodes);

  // A fixed scale, so words stay wide enough to read; short readings still fill the card (min-width 100%).
  elements.timingEmpty.hidden = true;
  elements.timeline.hidden = false;
  elements.ribbon.style.width = `${Math.ceil(total * PIXELS_PER_SECOND)}px`;
  elements.ribbonScroll.scrollLeft = 0;
  const pixelsPerSecond = elements.ribbon.clientWidth / total;
  // Ticks at least ~56 px apart, on a round step.
  const step = [0.5, 1, 2, 5, 10, 30, 60].find(candidate => candidate * pixelsPerSecond >= 56) ?? 60;
  const ticks: HTMLElement[] = [];
  for (let at = 0; at <= total + 1e-6; at += step) {
    const tick = Object.assign(document.createElement('span'), { className: 'tick', textContent: `${Number(at.toFixed(1))}${t('seconds')}` });
    tick.style.insetInlineStart = percent(at);
    ticks.push(tick);
  }
  elements.ticks.replaceChildren(...ticks);

  // The stats come from the engine (timings.stats), so hosts get the same numbers.
  elements.statWords.textContent = String(next.stats.words);
  setStat(elements.statLength, total.toFixed(2), t('seconds'));
  setStat(elements.statPace, String(Math.round(next.stats.wordsPerMinute)), t('wpm'));
  setStat(elements.statPauses, String(Math.round(next.stats.pausePercent)), '%');
  elements.timingJson.textContent = JSON.stringify({ duration: next.duration, stats: next.stats, words: next.words, displayWords: next.displayWords }, null, 1);
  // Empty until a word is hovered, focused or read; the tips below the ribbon explain how.
  elements.readout.replaceChildren();
  setClock(0, total);
  fitLabels();
  log(`timings: ${heard.length} words over ${total.toFixed(2)} s`);
}

const PIXELS_PER_SECOND = 140;
let ribbonScrollUntil = 0;

/**
 * Keeps the playhead visible on a long ribbon: when it nears the far edge of the view (or is out of it), the ribbon
 * glides so the playhead sits near the start of the view again. `offset` is pixels from the ribbon's start (its right
 * edge); in right-to-left scrolling, scrollLeft is 0 at the start and negative further along.
 */
function keepPlayheadInView(offset: number): void {
  const view = elements.ribbonScroll;
  if (view.scrollWidth <= view.clientWidth || performance.now() < ribbonScrollUntil) return;
  const visibleFrom = -view.scrollLeft;
  const visibleTo = visibleFrom + view.clientWidth;
  if (offset >= visibleFrom && offset <= visibleTo - view.clientWidth * 0.15) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  view.scrollTo({ left: -Math.max(0, offset - view.clientWidth * 0.2), behavior: smooth ? 'smooth' : 'auto' });
  ribbonScrollUntil = performance.now() + (smooth ? 450 : 0);
}

/** A word on the ribbon was clicked: play from its start (replacing any playback), if the audio is ready. */
function playFromWord(start: number): void {
  if (modelBusy || !audio) return;
  void play(start);
}

/** Moves the playhead with the audio, every frame, while the voice reads. */
let playheadLoop = 0;

function followPlayhead(): void {
  const loop = ++playheadLoop;
  const step = () => {
    if (loop !== playheadLoop || !reader || !timings || document.body.dataset.playback !== 'playing') return;
    const position = reader.position();
    if (position !== null) {
      const fraction = Math.min(position / Math.max(timings.duration, 0.001), 1);
      const offset = fraction * elements.track.clientWidth;
      elements.playhead.style.transform = `translateX(${-offset}px)`;
      keepPlayheadInView(offset);
      setClock(Math.min(position, timings.duration), timings.duration);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Swaps the text box for a read-only copy with one span per word (a textarea can't highlight words). */
function showReadingView(text: string): HTMLElement[] {
  const spans: HTMLElement[] = [];
  const parts: Node[] = [];
  let last = 0;
  for (const word of splitDisplayWords(text)) {
    if (word.charStart > last) parts.push(document.createTextNode(text.slice(last, word.charStart)));
    const span = Object.assign(document.createElement('span'), { className: 'w', textContent: word.text });
    spans.push(span);
    parts.push(span);
    last = word.charEnd;
  }
  parts.push(document.createTextNode(text.slice(last)));
  elements.reading.replaceChildren(...parts);
  elements.reading.style.minHeight = `${elements.text.offsetHeight}px`;
  elements.text.hidden = true;
  elements.reading.hidden = false;
  return spans;
}

function hideReadingView(): void {
  elements.reading.hidden = true;
  elements.text.hidden = false;
}

/** Counts playbacks, so one that was replaced (Read again, a word clicked) doesn't tidy up the one now playing. */
let playRun = 0;

/** Plays the prepared audio, from `from` seconds in (a clicked word's start) or from the beginning. */
async function play(from = 0): Promise<void> {
  const prepared = audio;
  if (!reader || !prepared) return;
  const run = ++playRun;
  clearError();
  elements.stop.disabled = false;
  const startedAt = performance.now();
  const stopListening = reader.on('state', (state) => {
    if (state === 'playing') log(`first audio after ${Math.round(performance.now() - startedAt)} ms`);
  });
  stoppedByListener = false;
  const spans = showReadingView(elements.text.value);
  let wordCount = 0;
  const stopHighlighting = reader.on('word', (word) => {
    wordCount++;
    spans.forEach((span, index) => {
      span.classList.toggle('read', index < word.displayIndex);
      span.classList.toggle('current', index === word.displayIndex);
    });
    for (const [displayIndex, segment] of segments) {
      segment.classList.toggle('read', displayIndex < word.displayIndex);
      segment.classList.toggle('current', displayIndex === word.displayIndex);
    }
    describeWord(word);
  });
  try {
    await reader.play(prepared, { from });
  }
  catch {
    // Shown through the error event; pressing play again is the retry.
  }
  finally {
    stopListening();
    stopHighlighting();
    // Replaced by a newer playback: leave the reading view, ribbon and buttons to it.
    if (run !== playRun) return;
    hideReadingView();
    // The word being read when playback ended was heard (at least in part).
    for (const segment of segments.values()) {
      if (segment.classList.contains('current')) segment.classList.replace('current', 'read');
    }
    if (timings && !stoppedByListener) setClock(timings.duration, timings.duration);
    if (wordCount > 0) log(`highlighted ${wordCount} words`);
    elements.stop.disabled = true;
  }
}

/**
 * Switches the interface language and redraws everything already on screen in it: fixed text (data-i18n), the status
 * line, playback state, file details, voice and mode names, an error being shown, and the timing card.
 */
function switchLocale(): void {
  applyLocale(locale() === 'ar' ? 'en' : 'ar');
  elements.stage.textContent = stageText();
  if (playbackState) elements.playback.textContent = t(`state.${playbackState}`);
  updateAudioControls();
  showMode(mode);
  for (const option of modeOptions()) {
    const label = option.querySelector('.label');
    if (label) label.textContent = pick(MODE_LABELS[option.dataset.value as Backend]);
  }
  for (const label of elements.voices.querySelectorAll('label')) {
    const voice = voices.find(candidate => candidate.id === label.querySelector('input')?.value);
    const text = label.querySelector('.label');
    if (voice && text) text.textContent = pick(voice.label);
  }
  if (!elements.message.hidden && lastShownError instanceof QariError) elements.message.textContent = pick(lastShownError.text);
  elements.readout.replaceChildren();
  if (timings) {
    // Redraw the ribbon, ticks and stats in the new language (a new object, so it isn't treated as a replay).
    const current = timings;
    timings = null;
    renderTimeline(current);
  }
}

applyLocale();
elements.stage.textContent = stageText();
elements.locale.addEventListener('click', switchLocale);
buildModeList();
elements.prepare.addEventListener('click', () => void prepare());
elements.play.addEventListener('click', () => void play());
elements.stop.addEventListener('click', () => {
  stoppedByListener = true;
  reader?.stop();
});
elements.clearCache.addEventListener('click', () => void clearCache());
elements.download.addEventListener('click', downloadAudio);
elements.text.addEventListener('input', discardAudio);
// Reading numbers as words changes the audio, so a change discards it, like an edit. On by default (Firefox may restore it).
elements.normalize.checked = true;
elements.normalize.addEventListener('change', discardAudio);

/** Sample texts; "numbers" has Western and Arabic-Indic digits, for testing normalization (Q3, not built yet). */
const SAMPLES: Readonly<Record<string, string>> = {
  greeting: 'اَلسَّلامُ عَلَيكُم يَا صَدِيقِي، هَذَا قَارِئٌ يَقْرَأُ النُّصُوصَ بِصَوْتٍ وَاضِحٍ.',
  numbers: 'وُلِدَ جَدِّي فِي عَامِ 1950، وَلَهُ ٣ أَبْنَاءٍ وَ12 حَفِيدًا.',
};
for (const button of document.querySelectorAll<HTMLButtonElement>('.sample')) {
  button.addEventListener('click', () => {
    if (modelBusy) return;
    elements.text.value = SAMPLES[button.dataset.sample ?? ''] ?? '';
    discardAudio();
  });
}
// Firefox restores buttons' disabled state on reload; start from the real state (no voice yet).
elements.stop.disabled = true;
updateAudioControls();
window.addEventListener('resize', fitLabels);
elements.isolated.textContent = String(globalThis.crossOriginIsolated);

void probeDevice().then((probe) => {
  elements.probe.textContent = `${probe.backend === 'webgpu' ? 'available' : 'unavailable'} (${probe.reason}${probe.gflops ? `, ${probe.gflops.toFixed(1)} GFLOPS` : ''})`;
  if (probe.backend !== 'webgpu') {
    // Still selectable: choosing it explains, in plain words, why it can't run here.
    // Each language in its own piece, so a narrow screen wraps between them instead of interleaving the two.
    // data-i18n, so switching language translates it too.
    const note = Object.assign(document.createElement('small'), { className: 'note', textContent: t('notAvailableHere') });
    note.dataset.i18n = 'notAvailableHere';
    const accelerated = document.getElementById('mode-webgpu');
    accelerated?.insertBefore(note, accelerated.querySelector('.check'));
    note.before(' ');
  }
});
void loadVoices().catch(error => log(`error loading voice configs: ${error instanceof Error ? error.message : String(error)}`));
