/** Q1 demo: prepare Male/Female sound in default or accelerated mode, read a sentence. `?voice-base=<url>` loads configs from elsewhere. */
import { createReader, loadVoiceConfig, MODE_LABELS, probeDevice, QariError } from '@khaledelansari/qari-core';
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
}

const clearError = () => {
  elements.message.hidden = true;
};

function showProgress(progress: LoadProgress): void {
  if (progress.stage === 'downloading') {
    elements.progress.max = Math.max(progress.totalBytes, 1);
    elements.progress.value = progress.loadedBytes;
    const total = progress.totalBytes > 0 ? ` / ${megabytes(progress.totalBytes)}` : '';
    elements.stage.textContent = progress.fromCache
      ? `From cache (${megabytes(progress.loadedBytes)} MB)`
      : `Downloading ${megabytes(progress.loadedBytes)}${total} MB`;
    return;
  }
  elements.progress.removeAttribute('value');
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
    label.innerHTML = `<input type="radio" name="voice" value="${voice.id}"> ${voice.label.ar} · ${voice.label.en} `;
    const radio = label.querySelector('input') as HTMLInputElement;
    radio.checked = voice === defaultVoice;
    radio.addEventListener('change', () => void switchVoice());
    elements.voices.append(label);
  }
  elements.modelUrl.value = defaultVoice.model.url;
  elements.vocoderUrl.value = defaultVoice.vocoder?.url ?? '';
}

async function prepare(): Promise<void> {
  elements.prepare.disabled = true;
  elements.play.disabled = true;
  clearError();
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
    });
    elements.progress.max = 1;
    elements.progress.value = 1;
    elements.stage.textContent = readyText(reader);
    log(`voice ${reader.voice.id} ready in ${Math.round(performance.now() - startedAt)} ms on ${reader.backend}`);
    elements.play.disabled = false;
  }
  catch (error) {
    elements.stage.textContent = 'Not loaded';
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
elements.isolated.textContent = String(globalThis.crossOriginIsolated);

void probeDevice().then((probe) => {
  elements.probe.textContent = `${probe.backend === 'webgpu' ? 'available' : 'unavailable'} (${probe.reason}${probe.gflops ? `, ${probe.gflops.toFixed(1)} GFLOPS` : ''})`;
});
void loadVoices().catch(error => log(`error loading voice configs: ${error instanceof Error ? error.message : String(error)}`));
