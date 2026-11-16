import { CACHE_DIRECTORY, cacheFileName, clearVoiceCache, concatChunks, fetchModel, readCached, writeCached } from './model-store';
import type { CacheDirectory } from './model-store';

/** In-memory stand-in for an OPFS directory; supports the createWritable path only. */
function setup() {
  const files = new Map<string, Uint8Array>();
  const directory: CacheDirectory = {
    async getFileHandle(name, options) {
      if (!files.has(name) && !options?.create) throw new Error('NotFoundError');
      if (!files.has(name)) files.set(name, new Uint8Array());
      return {
        async getFile() {
          const bytes = files.get(name) ?? new Uint8Array();
          return { size: bytes.length, text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer };
        },
        async createWritable() {
          const write = async (bytes: Uint8Array) => {
            files.set(name, bytes.slice());
          };
          return { write, close: async () => undefined };
        },
      } as never;
    },
  };
  const modelBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const fetcher = jest.fn(async () => new Response(modelBytes, { headers: { 'content-length': '5' } })) as unknown as typeof fetch;
  const file = { url: 'https://models.example/mixer128.onnx', version: '2024-09-20' };
  return { files, directory, fetcher, file, modelBytes };
}

describe('model store (Q1, PRD Q1)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keys the cache by url and version', async () => {
    const name = await cacheFileName({ url: 'https://a/m.onnx', version: '1' });
    expect(name).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheFileName({ url: 'https://a/m.onnx', version: '2' })).not.toBe(name);
  });

  it('joins chunks in order', () => {
    expect(Array.from(concatChunks([new Uint8Array([1, 2]), new Uint8Array([3])]))).toEqual([1, 2, 3]);
  });

  it('downloads on the first visit and reads from the cache on the second', async () => {
    const { directory, fetcher, file, modelBytes } = setup();
    const progress: unknown[] = [];
    const options = { directory, fetcher, onProgress: (step: unknown) => progress.push(step), onWarning: jest.fn() };

    expect(Array.from(await fetchModel(file, options))).toEqual(Array.from(modelBytes));
    expect(Array.from(await fetchModel(file, options))).toEqual(Array.from(modelBytes));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(progress.at(0)).toEqual({ loadedBytes: 5, totalBytes: 5, fromCache: false });
    expect(progress.at(-1)).toEqual({ loadedBytes: 5, totalBytes: 5, fromCache: true });
  });

  it('ignores a cached file whose marker is missing or wrong', async () => {
    const { files, directory } = setup();
    await writeCached(directory, 'model', new Uint8Array([9, 9, 9]));
    expect(await readCached(directory, 'model')).not.toBeNull();

    files.set('model.ok', new TextEncoder().encode('4'));
    expect(await readCached(directory, 'model')).toBeNull();

    files.delete('model.ok');
    expect(await readCached(directory, 'model')).toBeNull();
  });

  it('names a missing file "voice unavailable" and a server or network failure "download failed"', async () => {
    const { directory, file } = setup();
    const options = (fetcher: typeof fetch) => ({ directory, fetcher, onProgress: jest.fn(), onWarning: jest.fn() });
    const respondWith = (status: number) => jest.fn(async () => new Response('nope', { status })) as unknown as typeof fetch;
    await expect(fetchModel(file, options(respondWith(404)))).rejects.toMatchObject({ code: 'voice-unavailable', detail: expect.stringContaining('HTTP 404') });
    await expect(fetchModel(file, options(respondWith(503)))).rejects.toMatchObject({ code: 'voice-download-failed' });
    const offline = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchModel(file, options(offline))).rejects.toMatchObject({ code: 'voice-download-failed', detail: expect.stringContaining('Failed to fetch') });
  });

  it('rejects an HTML page served with HTTP 200 for a missing model, and does not cache it', async () => {
    const { files, directory, file } = setup();
    const indexPage = jest.fn(async () => new Response('<!doctype html><title>demo</title>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })) as unknown as typeof fetch;
    await expect(fetchModel(file, { directory, fetcher: indexPage, onProgress: jest.fn(), onWarning: jest.fn() }))
      .rejects.toMatchObject({ code: 'voice-unavailable', detail: expect.stringContaining('HTML page') });
    expect(files.size).toBe(0);
  });

  it('rejects a download whose SHA-256 does not match', async () => {
    const { directory, fetcher, file } = setup();
    const options = { directory, fetcher, onProgress: jest.fn(), onWarning: jest.fn() };
    await expect(fetchModel({ ...file, sha256: '0'.repeat(64) }, options)).rejects.toMatchObject({ code: 'voice-unavailable', detail: expect.stringContaining('failed its SHA-256 check') });
  });

  it('still returns the model, with a warning, when there is no cache', async () => {
    const { fetcher, file } = setup();
    const onWarning = jest.fn();
    await fetchModel(file, { directory: null, fetcher, onProgress: jest.fn(), onWarning });
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('OPFS'));
  });

  describe('clearVoiceCache', () => {
    const withStorage = (getDirectory: () => Promise<unknown>) => {
      Object.defineProperty(globalThis, 'navigator', { value: { storage: { getDirectory } }, configurable: true });
    };
    afterEach(() => {
      Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
    });

    it('removes the whole cache directory', async () => {
      const removeEntry = jest.fn(async () => undefined);
      withStorage(async () => ({ removeEntry }));
      await expect(clearVoiceCache()).resolves.toBe(true);
      expect(removeEntry).toHaveBeenCalledWith(CACHE_DIRECTORY, { recursive: true });
    });

    it('treats an already empty cache as cleared, and reports no storage as false', async () => {
      withStorage(async () => ({ removeEntry: async () => {
        throw Object.assign(new Error('gone'), { name: 'NotFoundError' });
      } }));
      await expect(clearVoiceCache()).resolves.toBe(true);
      withStorage(async () => {
        throw new Error('SecurityError');
      });
      await expect(clearVoiceCache()).resolves.toBe(false);
    });

    it('turns a refused delete into a QariError', async () => {
      withStorage(async () => ({ removeEntry: async () => {
        throw Object.assign(new Error('busy'), { name: 'NoModificationAllowedError' });
      } }));
      await expect(clearVoiceCache()).rejects.toMatchObject({ code: 'unexpected', detail: expect.stringContaining('busy') });
    });
  });
});
