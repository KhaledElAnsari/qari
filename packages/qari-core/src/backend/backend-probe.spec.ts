import { MIN_GPU_GFLOPS, judgeBenchmark, probeBackend } from './backend-probe';

const adapterWith = (fields: Record<string, unknown>) => ({ requestDevice: jest.fn(), ...fields }) as never;
const gpuReturning = (adapter: unknown) => ({ requestAdapter: jest.fn(async () => adapter) }) as never;

describe('backend probe (Q1, PRD Q2)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('picks WASM when the browser has no WebGPU API', async () => {
    expect(await probeBackend(undefined)).toEqual({ backend: 'wasm', reason: 'no-webgpu-api' });
  });

  it('picks WASM when no adapter is available', async () => {
    expect(await probeBackend(gpuReturning(null))).toEqual({ backend: 'wasm', reason: 'no-adapter' });
  });

  it('treats a software adapter as no GPU, from either flag location', async () => {
    expect(await probeBackend(gpuReturning(adapterWith({ info: { isFallbackAdapter: true } })))).toEqual({ backend: 'wasm', reason: 'software-adapter' });
    expect(await probeBackend(gpuReturning(adapterWith({ isFallbackAdapter: true })))).toEqual({ backend: 'wasm', reason: 'software-adapter' });
  });

  it('falls back to WASM with the error when the probe throws', async () => {
    const requestDevice = jest.fn(async () => {
      throw new Error('device lost');
    });
    const adapter = adapterWith({ requestDevice });
    expect(await probeBackend(gpuReturning(adapter))).toEqual({ backend: 'wasm', reason: 'probe-failed', detail: 'device lost' });
  });

  it('accepts WebGPU only at or above the throughput threshold', () => {
    expect(judgeBenchmark(null)).toEqual({ backend: 'wasm', reason: 'too-slow' });
    expect(judgeBenchmark(0.2)).toEqual({ backend: 'wasm', reason: 'too-slow', gflops: 0.2 });
    expect(judgeBenchmark(MIN_GPU_GFLOPS)).toEqual({ backend: 'webgpu', reason: 'probe-passed', gflops: MIN_GPU_GFLOPS });
  });
});
