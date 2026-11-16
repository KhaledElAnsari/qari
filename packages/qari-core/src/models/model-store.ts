import { describeError, QariError } from '../errors/qari-error';
import type { ModelFile } from '../voice/voice-config';

/** Name of the OPFS directory that holds cached models. */
export const CACHE_DIRECTORY = 'qari-models';
const MARKER_SUFFIX = '.ok';

/** Byte counts for one file as it downloads; `fromCache` is true when nothing was downloaded. */
export interface FileProgress {
  loadedBytes: number;
  totalBytes: number;
  fromCache: boolean;
}

export type CacheWarning = (message: string) => void;

/** The parts of an OPFS directory handle the store uses (lets tests pass an in-memory fake). */
export interface CacheDirectory {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
}

interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: BufferSource, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}

/** Hex SHA-256 of some bytes. */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Cache file name for a model: SHA-256 of url#version, so a new version never reads an old file. */
export async function cacheFileName(file: ModelFile): Promise<string> {
  return sha256Hex(new TextEncoder().encode(`${file.url}#${file.version}`));
}

/** Joins downloaded chunks into one buffer. */
export function concatChunks(chunks: Uint8Array[], totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)): Uint8Array {
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Opens the OPFS cache directory, or returns null where OPFS isn't available (non-HTTPS, some private modes). */
export async function openCacheDirectory(): Promise<CacheDirectory | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(CACHE_DIRECTORY, { create: true });
  }
  catch {
    return null;
  }
}

async function writeFile(directory: CacheDirectory, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  if ('createWritable' in handle && typeof handle.createWritable === 'function') {
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return;
  }
  // Older Safari has no createWritable; sync access handles work there, but only inside a Worker.
  const access = await (handle as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }).createSyncAccessHandle();
  try {
    access.truncate(0);
    access.write(bytes, { at: 0 });
    access.flush();
  }
  finally {
    access.close();
  }
}

/** Reads a cached model, or null when it is missing or its marker doesn't match (an interrupted write). */
export async function readCached(directory: CacheDirectory, name: string): Promise<Uint8Array | null> {
  try {
    const marker = await (await directory.getFileHandle(name + MARKER_SUFFIX)).getFile();
    const expectedBytes = Number(await marker.text());
    const file = await (await directory.getFileHandle(name)).getFile();
    if (!Number.isInteger(expectedBytes) || file.size !== expectedBytes) return null;
    return new Uint8Array(await file.arrayBuffer());
  }
  catch {
    return null;
  }
}

/** Writes a model, then its marker; the marker is written last so a half-written file is never trusted. */
export async function writeCached(directory: CacheDirectory, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  await writeFile(directory, name, bytes);
  await writeFile(directory, name + MARKER_SUFFIX, new TextEncoder().encode(String(bytes.length)));
}

// The file isn't there (or isn't ours to fetch): retrying won't help, so it's "voice unavailable", not a download error.
const MISSING_FILE_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 410]);

/** Downloads a file, reporting bytes as they arrive (Content-Length first, then the config's sizeBytes). */
export async function download(file: ModelFile, onProgress: (progress: FileProgress) => void, fetcher: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  let response: Response;
  try {
    response = await fetcher(file.url);
  }
  catch (error) {
    throw new QariError('voice-download-failed', `Model ${file.url} could not be fetched: ${describeError(error)}`);
  }
  if (!response.ok || !response.body) {
    const code = MISSING_FILE_STATUSES.has(response.status) ? 'voice-unavailable' : 'voice-download-failed';
    throw new QariError(code, `Model ${file.url} returned HTTP ${response.status}.`);
  }
  // Dev servers and SPA hosts answer a missing file with their index page and HTTP 200. Never cache that as a model.
  if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    throw new QariError('voice-unavailable', `Model ${file.url} returned an HTML page instead of a model file. Is the file on the server at that path?`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : (file.sizeBytes ?? 0);
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loadedBytes += value.length;
      onProgress({ loadedBytes, totalBytes: Math.max(totalBytes, loadedBytes), fromCache: false });
    }
  }
  catch (error) {
    throw new QariError('voice-download-failed', `Model ${file.url} stopped downloading: ${describeError(error)}`);
  }
  return concatChunks(chunks, loadedBytes) as Uint8Array<ArrayBuffer>;
}

/** Options for fetchModel; `directory` null means "don't cache". */
export interface FetchModelOptions {
  directory: CacheDirectory | null;
  onProgress: (progress: FileProgress) => void;
  onWarning: CacheWarning;
  fetcher?: typeof fetch;
}

/** Returns a model's bytes from the OPFS cache, or downloads, verifies and caches it. */
export async function fetchModel(file: ModelFile, options: FetchModelOptions): Promise<Uint8Array> {
  const { directory, onProgress, onWarning, fetcher } = options;
  const name = await cacheFileName(file);
  if (directory) {
    const cached = await readCached(directory, name);
    if (cached) {
      onProgress({ loadedBytes: cached.length, totalBytes: cached.length, fromCache: true });
      return cached;
    }
  }

  const bytes = await download(file, onProgress, fetcher);
  if (file.sha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== file.sha256.toLowerCase()) throw new QariError('voice-unavailable', `Model ${file.url} failed its SHA-256 check (got ${actual}).`);
  }
  if (!directory) {
    onWarning('Browser storage (OPFS) is unavailable here, so the voice will download again on the next visit.');
    return bytes;
  }
  try {
    await writeCached(directory, name, bytes);
  }
  catch (error) {
    onWarning(`Could not cache ${file.url}: ${error instanceof Error ? error.message : String(error)}.`);
  }
  return bytes;
}
