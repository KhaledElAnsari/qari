/**
 * Downloads the model files the example voices need into voices/models/, before a site build (docs/deployment.md).
 * Reads every voices/*.json config, collects its relative model URLs (e.g. models/mixer128.onnx), and fetches each
 * missing file from QARI_MODELS_BASE_URL + file name. Files already there are kept. A config's sha256 is checked.
 *
 * Run: QARI_MODELS_BASE_URL=https://github.com/<owner>/<repo>/releases/download/models-v1/ node tools/fetch-models.ts
 * (Node 24 runs TypeScript directly.) Skip it locally when you put the files in voices/models/ by hand.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ModelFile {
  url: string;
  version: string;
  sha256?: string;
}

interface NeededFile {
  /** Path relative to voices/, e.g. models/vocos22.onnx. */
  path: string;
  sha256?: string;
  voiceIds: string[];
}

const VOICES_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'voices');
const MEGABYTE = 1024 * 1024;

const isRelative = (url: string) => !/^[a-z][a-z\d+.-]*:/i.test(url) && !url.startsWith('/');
const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Every relative model file the voice configs point at, once each. */
async function neededFiles(): Promise<NeededFile[]> {
  const configNames = (await readdir(VOICES_DIRECTORY)).filter(name => name.endsWith('.json') && name !== 'index.json');
  const files = new Map<string, NeededFile>();
  for (const configName of configNames) {
    const voice = JSON.parse(await readFile(join(VOICES_DIRECTORY, configName), 'utf8')) as { id: string; model: ModelFile; vocoder?: ModelFile };
    for (const model of [voice.model, voice.vocoder]) {
      if (!model || !isRelative(model.url)) continue;
      const file = files.get(model.url) ?? { path: model.url, sha256: model.sha256, voiceIds: [] };
      file.voiceIds.push(voice.id);
      files.set(model.url, file);
    }
  }
  return [...files.values()];
}

async function download(file: NeededFile, baseUrl: string): Promise<void> {
  const url = new URL(basename(file.path), baseUrl).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}. Is the file attached to the release under that exact name?`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (file.sha256 && sha256Hex(bytes) !== file.sha256.toLowerCase()) throw new Error(`${url} does not match the sha256 in the voice config.`);
  const target = join(VOICES_DIRECTORY, file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  console.log(`Downloaded ${file.path} (${(bytes.length / MEGABYTE).toFixed(1)} MB) for ${file.voiceIds.join(', ')}.`);
}

async function main(): Promise<void> {
  const files = await neededFiles();
  const missing = files.filter(file => !existsSync(join(VOICES_DIRECTORY, file.path)));
  for (const file of files.filter(file => !missing.includes(file))) console.log(`Keeping ${file.path} (already there).`);
  if (missing.length === 0) return;

  const baseUrl = process.env.QARI_MODELS_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error(`Missing ${missing.map(file => file.path).join(', ')} in voices/ and QARI_MODELS_BASE_URL is not set. `
      + 'Set it to the folder URL that holds the files (ending in /), or copy them into voices/models/ by hand.');
  }
  for (const file of missing) await download(file, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
