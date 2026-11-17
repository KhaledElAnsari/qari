import { PUNCTUATION } from './tokenizer';

/**
 * The decoder attends ahead of the sound it makes: comma pauses start a median 7 frames (325 ms) after the attention
 * reaches the comma (46 takes; bayan-onnx HANDOFF.md). So the sound at frame f belongs to where the attention was this
 * many frames earlier, and before that to the first letter.
 */
export const ATTENTION_LEAD_FRAMES = 7;
/** Frames quieter than this share of the median frame are the codec's fade-out after the last word. */
const SPEECH_END_LEVEL = 0.1;

export interface AttentionTimingsInput {
  /** Text position attended at each decoder step. */
  attSteps: readonly number[];
  /** Per model token: its word in the sentence, or NO_WORD / PUNCTUATION (BayanTokenizer.encodeWithWords). */
  tokenWords: readonly number[];
  wordCount: number;
  /** Audio frames of the take, and its samples. */
  frames: number;
  audio: Float32Array;
  frameStacking: number;
  samplesPerFrame: number;
  sampleRate: number;
  leadFrames?: number;
}

/**
 * Per word of a take, its start and end in seconds from the take's start (bayan-onnx/web/bayan-engine.js wordTimings).
 * A word runs from the frame the attention (never moving back) reaches its first letter to the frame it reaches the
 * next word; Arabic runs words together, so only punctuation leaves a pause, and the last word ends where the sound
 * fades. Good to about ±0.1–0.2 s. A word with nothing the voice says gets a zero-length span where the reading is.
 */
export function attentionWordSpans(input: AttentionTimingsInput): { start: number; end: number }[] {
  const { attSteps, tokenWords, wordCount, frames, audio, frameStacking, samplesPerFrame, sampleRate } = input;
  const lead = input.leadFrames ?? ATTENTION_LEAD_FRAMES;
  const reached = new Int32Array(frames);
  let furthest = 1;
  for (let frame = 0; frame < frames; frame++) {
    const step = Math.floor((frame - lead) / frameStacking);
    if (frame >= lead && step < attSteps.length) furthest = Math.max(furthest, attSteps[step]);
    reached[frame] = furthest;
  }

  const level = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let i = frame * samplesPerFrame; i < Math.min((frame + 1) * samplesPerFrame, audio.length); i++) sum += audio[i] * audio[i];
    level[frame] = Math.sqrt(sum / samplesPerFrame);
  }
  const median = Float32Array.from(level).sort()[frames >> 1] ?? 0;
  let speechEnd = frames;
  while (speechEnd > 0 && level[speechEnd - 1] < SPEECH_END_LEVEL * median) speechEnd--;

  const onset = (position: number) => {
    for (let frame = 0; frame < frames; frame++) if (reached[frame] >= position) return Math.min(frame, speechEnd);
    return speechEnd;
  };
  const seconds = (frame: number) => (frame * samplesPerFrame) / sampleRate;
  const spans: { start: number; end: number }[] = [];
  for (let word = 0; word < wordCount; word++) {
    const first = tokenWords.indexOf(word);
    const last = tokenWords.lastIndexOf(word);
    if (first < 0) {
      const at = spans.length > 0 ? spans[spans.length - 1].end : 0;
      spans.push({ start: at, end: at });
      continue;
    }
    const next = tokenWords.findIndex((owner, i) => i > last && owner >= 0);
    const pauseAfter = next < 0 || tokenWords.slice(last + 1, next).includes(PUNCTUATION);
    spans.push({ start: seconds(onset(first)), end: seconds(onset(pauseAfter ? last + 1 : next)) });
  }
  return spans;
}

