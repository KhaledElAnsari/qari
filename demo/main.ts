/**
 * Demo: prepare Male/Female sound in default or accelerated mode, read a sentence. `?voice-base=<path>` loads configs from
 * another folder on this same site (the browser tests use it); other sites are ignored, so a link can't point the demo at
 * someone else's files.
 * Also checks that the model files are on the server and can clear the saved voice files (OPFS).
 */
import { clearVoiceCache, createReader, encodeWav, splitDisplayWords, loadVoiceConfig, MODE_LABELS, probeDevice, QariError } from '@khaledelansari/qari-core';
import type { Backend, LoadProgress, Reader, Synthesis, VoiceConfig, WordTimings } from '@khaledelansari/qari-core';
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
  play: $<HTMLButtonElement>('play'),
  stop: $<HTMLButtonElement>('stop'),
  playback: $('playback'),
  reading: $('reading'),
  timingEmpty: $('timing-empty'),
  timingLoading: $('timing-loading'),
  timeline: $('timeline'),
  track: $('track'),
  playhead: $('playhead'),
  ticks: $('ticks'),
  readout: $('readout'),
  statWords: $('stat-words'),
  statLength: $('stat-length'),
  statPace: $('stat-pace'),
  statPauses: $('stat-pauses'),
  timingJson: $('timing-json'),
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
    ? `${(audio.pcm.length / audio.sampleRate).toFixed(1)} s · WAV · ${audio.sampleRate / 1000} kHz · mono · ${fileSize(44 + audio.pcm.length * 2)}`
    : 'لا يوجد صوت بعد · No audio yet';
}

/** Saves the prepared audio as a WAV file. It exists only in this page's memory, so this is the only way to keep it. */
function downloadAudio(): void {
  if (!audio || !reader) return;
  const blob = new Blob([encodeWav(audio.pcm, audio.sampleRate)], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const link = Object.assign(document.createElement('a'), { href: url, download: `qari-${reader.voice.id}-${stamp}.wav` });
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
  elements.modeTrigger.disabled = busy;
  elements.prepare.disabled = busy;
  elements.clearCache.disabled = busy;
  for (const radio of elements.voices.querySelectorAll('input')) radio.disabled = busy;
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
  elements.modeValue.replaceChildren(
    Object.assign(document.createElement('span'), { textContent: MODE_LABELS[next].ar }),
    ' ',
    Object.assign(document.createElement('small'), { textContent: MODE_LABELS[next].en, lang: 'en' }),
  );
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
      Object.assign(document.createElement('span'), { textContent: MODE_LABELS[value].ar }),
      ' ',
      Object.assign(document.createElement('small'), { textContent: MODE_LABELS[value].en, lang: 'en' }),
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

const readyText = (activeReader: Reader) => `Ready · ${activeReader.voice.label.en} · ${MODE_LABELS[activeReader.backend].en}`;

/** The error on screen, so one reported both as an event and as a rejection is shown once. */
let lastShownError: unknown = null;

/** Listeners see only the friendly text; the technical detail goes to the developer log. */
function showError(error: unknown): void {
  if (error === lastShownError && !elements.message.hidden) return;
  lastShownError = error;
  const qariError = error instanceof QariError ? error : new QariError('unexpected', String(error));
  elements.message.replaceChildren(
    Object.assign(document.createElement('span'), { textContent: qariError.text.ar, lang: 'ar' }),
    Object.assign(document.createElement('span'), { textContent: qariError.text.en, lang: 'en', dir: 'ltr' }),
  );
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
    elements.stage.textContent = 'Not loaded';
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
    elements.stage.textContent = progress.fromCache
      ? `From cache (${megabytes(progress.loadedBytes)} MB)`
      : `Downloading ${megabytes(progress.loadedBytes)}${total} MB`;
    return;
  }
  elements.progress.removeAttribute('value');
  setPhase('preparing');
  elements.stage.textContent = progress.stage === 'preparing' ? 'Preparing…' : 'Warming up…';
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
    label.innerHTML = `<input type="radio" name="voice" value="${voice.id}"><span>${voice.label.ar}</span> <small lang="en">${voice.label.en}</small>`;
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
    elements.playback.textContent = state;
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
  elements.stage.textContent = 'Preparing…';
  setPhase('downloading', 0);
  try {
    const activeReader = await loadSelectedVoice();
    setPhase('preparing');
    await makeAudio(activeReader);
    elements.progress.max = 1;
    elements.progress.value = 1;
    elements.stage.textContent = readyText(activeReader);
    setPhase('ready');
  }
  catch (error) {
    // A failed switch leaves the reader as it was (e.g. accelerated mode falls back to default): show that.
    if (reader) showMode(reader.backend);
    elements.stage.textContent = reader ? 'No audio yet' : 'Not loaded';
    setPhase('idle');
    showError(error);
  }
  finally {
    setModelBusy(false);
  }
}

const secondsText = (value: number) => `${value.toFixed(2)} s`;

/** Player clock: time heard / total length. */
const setClock = (position: number, total: number) => {
  elements.clock.textContent = `${position.toFixed(1)} / ${total.toFixed(1)} s`;
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
    audio = await activeReader.synthesize(text);
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
    elements.stage.textContent = 'Changed · prepare the audio again';
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
    segment.setAttribute('aria-label', `${word.text}: ${secondsText(word.start)} to ${secondsText(word.end)}`);
    for (const type of ['pointerenter', 'focus']) segment.addEventListener(type, () => describeWord(word));
    segments.set(word.displayIndex, segment);
    return segment;
  });
  elements.playhead.style.transform = 'translateX(0)';
  elements.track.replaceChildren(elements.playhead, ...nodes);

  const step = total > 8 ? 2 : total > 3 ? 1 : 0.5;
  const ticks: HTMLElement[] = [];
  for (let at = 0; at <= total + 1e-6; at += step) {
    const tick = Object.assign(document.createElement('span'), { className: 'tick', textContent: `${Number(at.toFixed(1))}s` });
    tick.style.insetInlineStart = percent(at);
    ticks.push(tick);
  }
  elements.ticks.replaceChildren(...ticks);

  // The stats come from the engine (timings.stats), so hosts get the same numbers.
  elements.statWords.textContent = String(next.stats.words);
  setStat(elements.statLength, total.toFixed(2), 's');
  setStat(elements.statPace, String(Math.round(next.stats.wordsPerMinute)), 'wpm');
  setStat(elements.statPauses, String(Math.round(next.stats.pausePercent)), '%');
  elements.timingJson.textContent = JSON.stringify({ duration: next.duration, stats: next.stats, words: next.words, displayWords: next.displayWords }, null, 1);
  elements.readout.replaceChildren('مرّر المؤشر على كلمة لترى توقيتها · ', Object.assign(document.createElement('span'), { textContent: 'Hover or focus a word to see its timing.', lang: 'en', dir: 'ltr' }));
  setClock(0, total);
  elements.timingEmpty.hidden = true;
  elements.timeline.hidden = false;
  fitLabels();
  log(`timings: ${heard.length} words over ${total.toFixed(2)} s`);
}

/** Moves the playhead with the audio, every frame, while the voice reads. */
function followPlayhead(): void {
  const step = () => {
    if (!reader || !timings || document.body.dataset.playback !== 'playing') return;
    const position = reader.position();
    if (position !== null) {
      const fraction = Math.min(position / Math.max(timings.duration, 0.001), 1);
      elements.playhead.style.transform = `translateX(${-fraction * elements.track.clientWidth}px)`;
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

async function play(): Promise<void> {
  const prepared = audio;
  if (!reader || !prepared) return;
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
    await reader.play(prepared);
  }
  catch {
    // Shown through the error event; pressing play again is the retry.
  }
  finally {
    stopListening();
    stopHighlighting();
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
    const note = Object.assign(document.createElement('small'), { className: 'note' });
    note.append(
      Object.assign(document.createElement('span'), { textContent: 'غير متاح على هذا الجهاز' }),
      ' · ',
      Object.assign(document.createElement('span'), { textContent: 'not available on this device', lang: 'en', dir: 'ltr' }),
    );
    const accelerated = document.getElementById('mode-webgpu');
    accelerated?.insertBefore(note, accelerated.querySelector('.check'));
    note.before(' ');
  }
});
void loadVoices().catch(error => log(`error loading voice configs: ${error instanceof Error ? error.message : String(error)}`));
