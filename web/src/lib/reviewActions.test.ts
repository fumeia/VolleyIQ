import { describe, expect, it } from 'vitest';
import { ACTIONS, REVIEW_ACTIONS, SKILLS } from './actions';

describe('action choices', () => {
  const playerActions = ACTIONS.filter((a) => a.needsPlayer !== false).map((a) => a.code).sort();
  it('review offers every player action (team actions come from the outcome buttons)', () => {
    expect([...REVIEW_ACTIONS].sort()).toEqual(playerActions);
  });
  it('the skill rows cover every player action once', () => {
    expect(SKILLS.flatMap((s) => s.codes).sort()).toEqual(playerActions);
  });
});
