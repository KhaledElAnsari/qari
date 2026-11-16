/** Peak level nipponjo's Python package scales its output to. */
export const DEFAULT_PEAK = 0.9;

/** Scales samples in place so the loudest one reaches `peak` (silence stays silent). */
export function peakNormalize(samples: Float32Array, peak = DEFAULT_PEAK): Float32Array {
  let loudest = 0;
  for (const sample of samples) loudest = Math.max(loudest, Math.abs(sample));
  // Same small epsilon as the Python package, so near-silence isn't blown up.
  const gain = peak / (loudest + 1e-5);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}
