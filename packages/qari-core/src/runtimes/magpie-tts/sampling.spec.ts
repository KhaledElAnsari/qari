import { isFinishedTake, mulberry32, newPriorState, nextPrior } from './sampling';
import type { BayanInference } from './bayan-config';

const inference: BayanInference = {
  temperature: 0.6, topk: 80, cfg_scale: 2.5, max_decoder_steps: 800, min_generated_frames: 4, apply_attention_prior: true,
  prior_epsilon: 0.1, lookahead_window: 5, sink_move_threshold: 8, sink_penalty_threshold: 10, short_text_len: 5,
};

describe('Bayan sampling helpers', () => {
  it('draws the same numbers as the exporter\'s Mulberry32 (seed 1234)', () => {
    const next = mulberry32(1234);
    for (const expected of [0.07329497812315822, 0.7034119898453355, 0.9028560190927237, 0.9705493662040681]) expect(next()).toBeCloseTo(expected, 15);
  });

  it('moves the prior to the most attended letter inside the lookahead window', () => {
    const state = newPriorState();
    const align = new Float32Array(20);
    align[4] = 1;
    const prior = nextPrior(align, state, 20, inference);
    expect(state.lastAtt).toBe(4);
    expect(Array.from(prior.slice(2, 11))).toEqual([0.1, 1, 1, 1, 1, 1, 1, 1, 0.1].map(Math.fround));
  });

  it('counts a take as finished only when it ended on the last letters', () => {
    expect(isFinishedTake({ eosFrame: 80, lastAtt: 55, textLength: 59 }, true)).toBe(true);
    expect(isFinishedTake({ eosFrame: 50, lastAtt: 42, textLength: 59 }, true)).toBe(false);
    expect(isFinishedTake({ eosFrame: null, lastAtt: 58, textLength: 59 }, true)).toBe(false);
    expect(isFinishedTake({ eosFrame: 50, lastAtt: 1, textLength: 59 }, false)).toBe(true);
  });
});
