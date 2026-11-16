/**
 * Demo: prepare Male/Female sound in default or accelerated mode, read a sentence. `?voice-base=<url>` loads configs from elsewhere.
 * Also checks that the model files are on the server and can clear the saved voice files (OPFS).
 */
import { clearVoiceCache, createReader, loadVoiceConfig, MODE_LABELS, probeDevice, QariError } from '@khaledelansari/qari-core';
import type { Backend, LoadProgress, Reader, VoiceConfig } from '@khaledelansari/qari-core';
import '@khaledelansari/qari-element';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MEGABYTE = 1024 * 1024;
const voiceBase = new URL(new URLSearchParams(location.search).get('voice-base') ?? './', location.href);

const elements = {
  probe: $('probe'),
  isolated: $('isolated'),
  voices: $('voices'),
  modelUrl: $<HTMLInputElement>('model-url'),
  vocoderUrl: $<HTMLInputElement>('vocoder-url'),
  mode: $<HTMLSelectElement>('backend'),
  prepare: $<HTMLButtonElement>('prepare'),
  progress: $<HTMLProgressElement>('progress'),
  stage: $('stage'),
  message: $('message'),
  text: $<HTMLTextAreaElement>('text'),
  play: $<HTMLButtonElement>('play'),
  stop: $<HTMLButtonElement>('stop'),
  playback: $('playback'),
  log: $('log'),
  filesNotice: $('files-notice'),
  clearCache: $<HTMLButtonElement>('clear-cache'),
  cacheStatus: $('cache-status'),
};

let voices: VoiceConfig[] = [];
let reader: Reader | null = null;

const log = (line: string) => {
  elements.log.textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
};

const megabytes = (bytes: number) => (bytes / MEGABYTE).toFixed(1);
const selectedMode = () => elements.mode.value as Backend;
const readyText = (activeReader: Reader) => `Ready · ${activeReader.voice.label.en} · ${MODE_LABELS[activeReader.backend].en}`;

/** Listeners see only the friendly text; the technical detail goes to the developer log. */
function showError(error: unknown): void {
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

/** Model URLs of every listed voice, plus the ones typed in the developer boxes, once each. */
function modelUrls(): string[] {
  const urls = voices.flatMap(voice => [voice.model.url, voice.vocoder?.url]);
  urls.push(elements.modelUrl.value, elements.vocoderUrl.value);
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
  fix.innerHTML = 'Put them in <code>voices/models/</code> (see <code>voices/models/README.md</code>), or run <code>npm run fetch-models</code>, then press Prepare voice again.';
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
  elements.clearCache.disabled = true;
  elements.play.disabled = true;
  try {
    await reader?.dispose();
    reader = null;
    elements.progress.value = 0;
    elements.stage.textContent = 'Not loaded';
    setPhase('idle');
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
    elements.clearCache.disabled = false;
  }
}

type Phase = 'idle' | 'downloading' | 'preparing' | 'ready';

/** Drives the design: the Prepare button fills as its own download bar, and the status dot turns green when ready. */
function setPhase(phase: Phase, fraction = 0): void {
  elements.prepare.dataset.phase = phase;
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

/** The selected voice, with the URL boxes applied (so other hosts' files can be tried without editing JSON). */
function selectedVoice(): VoiceConfig {
  const id = (document.querySelector<HTMLInputElement>('input[name="voice"]:checked'))?.value;
  const voice = voices.find(candidate => candidate.id === id) ?? voices[0];
  return {
    ...voice,
    model: { ...voice.model, url: elements.modelUrl.value || voice.model.url },
    vocoder: voice.vocoder && { ...voice.vocoder, url: elements.vocoderUrl.value || voice.vocoder.url },
  };
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
    radio.addEventListener('change', () => void switchVoice());
    elements.voices.append(label);
  }
  elements.voices.style.setProperty('--n', String(voices.length));
  elements.modelUrl.value = defaultVoice.model.url;
  elements.vocoderUrl.value = defaultVoice.vocoder?.url ?? '';
  const missing = await missingModelFiles();
  if (missing.length > 0) showMissingFiles(missing);
}

async function prepare(): Promise<void> {
  elements.prepare.disabled = true;
  elements.play.disabled = true;
  clearError();
  setPhase('downloading', 0);
  const startedAt = performance.now();
  try {
    await reader?.dispose();
    reader = null;
    reader = await createReader({ voice: selectedVoice(), backend: selectedMode() });
    reader.on('progress', showProgress);
    reader.on('warning', message => log(`warning: ${message}`));
    reader.on('error', showError);
    reader.on('state', (state) => {
      elements.playback.textContent = state;
      document.body.dataset.playback = state;
    });
    elements.progress.max = 1;
    elements.progress.value = 1;
    elements.stage.textContent = readyText(reader);
    setPhase('ready');
    log(`voice ${reader.voice.id} ready in ${Math.round(performance.now() - startedAt)} ms on ${reader.backend}`);
    elements.play.disabled = false;
  }
  catch (error) {
    elements.stage.textContent = 'Not loaded';
    setPhase('idle');
    showError(error);
  }
  finally {
    elements.prepare.disabled = false;
  }
}

/** Male ↔ Female sound share model files, so a prepared reader switches without downloading. */
async function switchVoice(): Promise<void> {
  if (!reader) return;
  clearError();
  const startedAt = performance.now();
  try {
    await reader.setVoice(selectedVoice());
    log(`switched to ${reader.voice.id} in ${Math.round(performance.now() - startedAt)} ms`);
  }
  catch {
    // Shown through the error event; the reader kept the previous voice.
  }
  elements.stage.textContent = readyText(reader);
}

/** Changing mode on a prepared reader reloads it in that mode; if accelerated mode fails, the reader stays in the old mode. */
async function switchMode(): Promise<void> {
  if (!reader) return;
  clearError();
  elements.play.disabled = true;
  try {
    await reader.setBackend(selectedMode());
    log(`now in ${reader.backend}`);
  }
  catch {
    elements.mode.value = reader.backend;
  }
  elements.stage.textContent = readyText(reader);
  elements.play.disabled = false;
}

async function play(): Promise<void> {
  if (!reader) return;
  clearError();
  elements.stop.disabled = false;
  const startedAt = performance.now();
  const stopListening = reader.on('state', (state) => {
    if (state === 'playing') log(`first audio after ${Math.round(performance.now() - startedAt)} ms`);
  });
  try {
    await reader.speak(elements.text.value);
  }
  catch {
    // Shown through the error event; pressing play again is the retry.
  }
  finally {
    stopListening();
    elements.stop.disabled = true;
  }
}

for (const option of elements.mode.options) {
  const label = MODE_LABELS[option.value as Backend];
  option.textContent = `${label.ar} · ${label.en}`;
}
elements.prepare.addEventListener('click', () => void prepare());
elements.play.addEventListener('click', () => void play());
elements.stop.addEventListener('click', () => reader?.stop());
elements.mode.addEventListener('change', () => void switchMode());
elements.clearCache.addEventListener('click', () => void clearCache());
elements.isolated.textContent = String(globalThis.crossOriginIsolated);

void probeDevice().then((probe) => {
  elements.probe.textContent = `${probe.backend === 'webgpu' ? 'available' : 'unavailable'} (${probe.reason}${probe.gflops ? `, ${probe.gflops.toFixed(1)} GFLOPS` : ''})`;
});
void loadVoices().catch(error => log(`error loading voice configs: ${error instanceof Error ? error.message : String(error)}`));
