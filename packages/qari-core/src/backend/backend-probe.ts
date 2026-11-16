/** How a voice runs: 'wasm' (default mode, the default) or 'webgpu' (accelerated mode, only when chosen). */
export type Backend = 'webgpu' | 'wasm';

export type WasmReason = 'no-webgpu-api' | 'no-adapter' | 'software-adapter' | 'too-slow' | 'probe-failed';

/** Whether accelerated mode can run on this device; `gflops` is the measured compute-shader throughput when a benchmark ran. */
export type ProbeResult =
  | { backend: 'webgpu'; reason: 'probe-passed'; gflops?: number }
  | { backend: 'wasm'; reason: WasmReason; gflops?: number; detail?: string };

/** SwiftShader measured 0.2 and single-thread JS 0.47 GFLOPS in the research; any real GPU clears 5 easily. */
export const MIN_GPU_GFLOPS = 5;
export const PROBE_BUDGET_MS = 2000;

const WORKGROUP_SIZE = 64;
const WORKGROUPS = 1024;
const LOOP_ITERATIONS = 4096;
// Two fused multiply-adds per iteration, two floating-point operations each.
const PROBE_FLOPS = WORKGROUPS * WORKGROUP_SIZE * LOOP_ITERATIONS * 4;

const PROBE_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> results: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  var a = f32(id.x) * 0.0001;
  var c = 0.0;
  for (var i = 0u; i < ${LOOP_ITERATIONS}u; i++) {
    c = fma(a, 1.0001, c);
    a = fma(c, 0.9999, a);
  }
  results[id.x] = c;
}
`;

/** Turns a measured throughput (null = didn't finish in budget) into a backend decision. */
export function judgeBenchmark(gflops: number | null): ProbeResult {
  if (gflops === null) return { backend: 'wasm', reason: 'too-slow' };
  if (gflops < MIN_GPU_GFLOPS) return { backend: 'wasm', reason: 'too-slow', gflops };
  return { backend: 'webgpu', reason: 'probe-passed', gflops };
}

/** Reads the fallback flag from both the current (`adapter.info`) and the older (`adapter`) location. */
export function isSoftwareAdapter(adapter: GPUAdapter): boolean {
  const info = (adapter as unknown as { info?: { isFallbackAdapter?: boolean } }).info;
  const legacy = (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter;
  return info?.isFallbackAdapter === true || legacy === true;
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  }
  finally {
    clearTimeout(timer);
  }
};

/** Runs the compute shader once and returns its duration in milliseconds. */
async function runShader(device: GPUDevice, pipeline: GPUComputePipeline, bindGroup: GPUBindGroup): Promise<number> {
  const startedAt = performance.now();
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(WORKGROUPS);
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  return performance.now() - startedAt;
}

/** Measures compute throughput in GFLOPS; the first run compiles the shader and is not counted. */
async function benchmark(device: GPUDevice): Promise<number> {
  const buffer = device.createBuffer({ size: WORKGROUPS * WORKGROUP_SIZE * 4, usage: GPUBufferUsage.STORAGE });
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: PROBE_SHADER }), entryPoint: 'main' },
  });
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
  await runShader(device, pipeline, bindGroup);
  const elapsedMs = await runShader(device, pipeline, bindGroup);
  buffer.destroy();
  return PROBE_FLOPS / (Math.max(elapsedMs, 0.01) / 1000) / 1e9;
}

/**
 * Says whether accelerated mode (WebGPU) can run here: only a real adapter that passes the micro-benchmark qualifies.
 * Never reads vendor strings (GPUAdapterInfo is minimal and Brave empties it).
 */
export async function probeBackend(gpu: GPU | undefined, budgetMs = PROBE_BUDGET_MS): Promise<ProbeResult> {
  if (!gpu) return { backend: 'wasm', reason: 'no-webgpu-api' };
  let device: GPUDevice | null = null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { backend: 'wasm', reason: 'no-adapter' };
    if (isSoftwareAdapter(adapter)) return { backend: 'wasm', reason: 'software-adapter' };
    device = await adapter.requestDevice();
    return judgeBenchmark(await withTimeout(benchmark(device), budgetMs));
  }
  catch (error) {
    return { backend: 'wasm', reason: 'probe-failed', detail: error instanceof Error ? error.message : String(error) };
  }
  finally {
    device?.destroy();
  }
}
