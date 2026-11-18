/** One ONNX file a voice needs; the cache is keyed by url + version. */
export interface ModelFile {
  url: string;
  version: string;
  /** Used for progress only when the server sends no Content-Length. */
  sizeBytes?: number;
  /** Hex SHA-256; checked after download when present. */
  sha256?: string;
}

export const TIMINGS_MODES = ['native', 'alignment', 'none'] as const;
export type TimingsMode = (typeof TIMINGS_MODES)[number];

/** A voice: model files, the adapter that runs them, and how to present it (PRD 5.3); Arabic only in the beta. */
export interface VoiceConfig {
  id: string;
  label: { en: string; ar: string };
  /** Multi-speaker models: 1 = Sami, 3 = Amal for nipponjo. */
  speaker?: number;
  isDefault?: boolean;
  model: ModelFile;
  /** Second file for two-stage voices (acoustic model + vocoder), e.g. nipponjo Mixer-TTS + Vocos. */
  vocoder?: ModelFile;
  /** Any further files the runtime needs, by the name its adapter reads (e.g. Bayan's text encoder and config). */
  files?: Record<string, ModelFile>;
  runtime: 'piper-vits' | 'mixer-tts' | (string & {});
  frontend: { kind: 'piper-phonemize' | 'arabic-phonetiser' | (string & {}); dataUrl?: string };
  sampleRate: number;
  timings: TimingsMode;
  durationOutput?: string;
  /** Speed multiplier: 1 is the model's normal speed, above 1 is faster. */
  defaultPace?: number;
  licence: { type: string };
  sampleUrl?: string;
}

export type VoiceConfigResult = { ok: true; voice: VoiceConfig } | { ok: false; reason: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isOptional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);
const isPositiveNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;

function modelFileProblem(value: unknown, field: string): string | null {
  if (!isObject(value)) return `${field} must be an object`;
  if (!isText(value.url)) return `${field}.url must be a non-empty string`;
  if (!isText(value.version)) return `${field}.version must be a non-empty string`;
  if (!isOptional(value.sizeBytes, isPositiveNumber)) return `${field}.sizeBytes must be a positive number`;
  if (!isOptional(value.sha256, sha => typeof sha === 'string' && /^[0-9a-f]{64}$/i.test(sha))) return `${field}.sha256 must be 64 hex characters`;
  return null;
}

function filesProblem(value: unknown): string | null {
  if (!isObject(value)) return 'files must be an object';
  for (const [name, file] of Object.entries(value)) {
    const problem = modelFileProblem(file, `files.${name}`);
    if (problem) return problem;
  }
  return null;
}

/** Checks a parsed voice-config JSON value and returns it typed, or the first problem found. */
export function parseVoiceConfig(value: unknown): VoiceConfigResult {
  if (!isObject(value)) return { ok: false, reason: 'voice config must be an object' };
  const problems: (string | null)[] = [
    isText(value.id) ? null : 'id must be a non-empty string',
    isObject(value.label) && isText(value.label.en) && isText(value.label.ar) ? null : 'label must have en and ar strings',
    isOptional(value.speaker, speaker => Number.isInteger(speaker) && (speaker as number) >= 0) ? null : 'speaker must be a non-negative integer',
    isOptional(value.isDefault, flag => typeof flag === 'boolean') ? null : 'isDefault must be a boolean',
    modelFileProblem(value.model, 'model'),
    value.vocoder === undefined ? null : modelFileProblem(value.vocoder, 'vocoder'),
    value.files === undefined ? null : filesProblem(value.files),
    isText(value.runtime) ? null : 'runtime must be a non-empty string',
    isObject(value.frontend) && isText(value.frontend.kind) && isOptional(value.frontend.dataUrl, isText) ? null : 'frontend.kind must be a non-empty string',
    isPositiveNumber(value.sampleRate) ? null : 'sampleRate must be a positive number',
    TIMINGS_MODES.includes(value.timings as TimingsMode) ? null : `timings must be one of ${TIMINGS_MODES.join(', ')}`,
    value.timings !== 'native' || isText(value.durationOutput) ? null : 'durationOutput is required when timings is native',
    isOptional(value.defaultPace, isPositiveNumber) ? null : 'defaultPace must be a positive number',
    isObject(value.licence) && isText(value.licence.type) ? null : 'licence.type must be a non-empty string',
    isOptional(value.sampleUrl, isText) ? null : 'sampleUrl must be a non-empty string',
  ];
  const reason = problems.find(problem => problem !== null);
  if (reason) return { ok: false, reason };
  return { ok: true, voice: value as unknown as VoiceConfig };
}

/** Every file of a voice, in download order: model, vocoder, then the named extra files. */
export function voiceFiles(voice: VoiceConfig): ModelFile[] {
  return [voice.model, ...(voice.vocoder ? [voice.vocoder] : []), ...Object.values(voice.files ?? {})];
}

/** Resolves relative model, vocoder, extra-file, sample and data URLs against the URL the config was loaded from. */
export function resolveVoiceUrls(voice: VoiceConfig, baseUrl: string): VoiceConfig {
  const resolve = (url: string) => new URL(url, baseUrl).href;
  return {
    ...voice,
    model: { ...voice.model, url: resolve(voice.model.url) },
    vocoder: voice.vocoder && { ...voice.vocoder, url: resolve(voice.vocoder.url) },
    files: voice.files && Object.fromEntries(Object.entries(voice.files).map(([name, file]) => [name, { ...file, url: resolve(file.url) }])),
    frontend: { ...voice.frontend, dataUrl: voice.frontend.dataUrl && resolve(voice.frontend.dataUrl) },
    sampleUrl: voice.sampleUrl && resolve(voice.sampleUrl),
  };
}

/** Fetches a voice config JSON from a host URL, checks it and resolves its relative URLs. */
export async function loadVoiceConfig(url: string | URL): Promise<VoiceConfig> {
  const absoluteUrl = new URL(url, globalThis.location?.href).href;
  const response = await fetch(absoluteUrl);
  if (!response.ok) throw new Error(`Voice config ${absoluteUrl} returned HTTP ${response.status}.`);
  const result = parseVoiceConfig(await response.json());
  if (!result.ok) throw new Error(`Voice config ${absoluteUrl} is invalid: ${result.reason}.`);
  return resolveVoiceUrls(result.voice, absoluteUrl);
}

/** Two voices that differ only in speaker or labels share loaded model sessions. */
export function modelKey(voice: VoiceConfig): string {
  const file = (model: ModelFile | undefined) => (model ? `${model.url}#${model.version}` : '-');
  const extra = Object.entries(voice.files ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, model]) => `${name}=${file(model)}`);
  return [voice.runtime, voice.frontend.kind, file(voice.model), file(voice.vocoder), ...extra].join('|');
}
