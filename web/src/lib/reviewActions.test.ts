import { describe, expect, it } from 'vitest';
import { ACTIONS, REVIEW_ACTIONS } from './actions';

describe('review action choices', () => {
  it('offer every player action (team actions come from the outcome buttons)', () => {
    const playerActions = ACTIONS.filter((a) => a.needsPlayer !== false).map((a) => a.code);
    expect([...REVIEW_ACTIONS].sort()).toEqual([...playerActions].sort());
  });
});
