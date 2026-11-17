import type { BayanInference } from './bayan-config';

/** Seeded PRNG, identical to Mulberry32 in the exporter, so a seed gives the same codes in Python and here. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the decoder is in the text, carried from step to step. */
export interface PriorState {
  lastAtt: number;
  counter: Map<number, number>;
}

export const newPriorState = (): PriorState => ({ lastAtt: 1, counter: new Map() });

/**
 * NeMo get_most_attended_text_timestep + construct_inference_prior for one sentence (the conditional row):
 * finds the text position the decoder attends to and builds the attention prior for the next step.
 */
export function nextPrior(align: ArrayLike<number>, state: PriorState, textLength: number, inference: BayanInference): Float32Array {
  let last = state.lastAtt;
  if ((state.counter.get(last) ?? 0) >= inference.sink_move_threshold) last += 1;
  const end = Math.min(last + inference.lookahead_window, textLength - 3);
  let attended: number;
  if (end <= last) attended = textLength - 1;
  else {
    attended = last;
    for (let i = last + 1; i < end; i++) if (align[i] > align[attended]) attended = i;
  }
  state.counter.set(attended, (state.counter.get(attended) ?? 0) + 1);
  state.lastAtt = attended;
  const epsilon = inference.prior_epsilon;
  const prior = new Float32Array(textLength).fill(epsilon);
  if (textLength <= inference.short_text_len) prior.fill(1);
  else {
    prior[Math.max(1, attended - 1)] = 1;
    prior[attended] = 1;
    for (let j = 1; j <= inference.lookahead_window; j++) prior[Math.min(attended + j, textLength - 1)] = 1;
  }
  for (const [position, count] of state.counter) if (count >= inference.sink_penalty_threshold) prior.fill(epsilon, 0, position + 1);
  return prior;
}

/**
 * A take is finished when it reached end of speech with the decoder on the last letters of the text. The attended
 * position can't pass length - 4 before the end window closes; every full take of the test sentences ended there or
 * later, every cut-off take 17 or more letters short (bayan-onnx HANDOFF.md, 90 takes).
 */
export function isFinishedTake(take: { eosFrame: number | null; lastAtt: number; textLength: number }, usesPrior: boolean): boolean {
  return take.eosFrame !== null && (!usesPrior || take.lastAtt >= take.textLength - 4);
}
