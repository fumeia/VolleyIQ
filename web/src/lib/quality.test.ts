import { describe, expect, it } from 'vitest';
import { findIssues } from './quality';
import type { VEvent } from './api';

let id = 0;
const ev = (action: VEvent['action'], extra: Partial<VEvent> = {}) =>
  ({ id: ++id, action, value: null, zone: null, set_no: 1, status: 'confirmed', player_id: 1, rally: 1, ...extra }) as VEvent;

describe('findIssues', () => {
  it('flags an action with no player', () => {
    const issues = findIssues([ev('attack', { player_id: null }), ev('kill')]);
    expect(issues.size).toBe(1);
    expect([...issues.values()][0]).toBe('No player');
  });

  it('does not flag team-level actions without a player', () => {
    expect(findIssues([ev('opp_error', { player_id: null })]).size).toBe(0);
  });

  it('flags a receive without a grade but not one with a grade', () => {
    const issues = findIssues([ev('receive', { value: null }), ev('receive', { value: 2 })]);
    expect(issues.size).toBe(1);
    expect([...issues.values()][0]).toBe('Pass grade missing');
  });

  it('flags two serves in the same rally', () => {
    const issues = findIssues([ev('serve', { rally: 5 }), ev('ace', { rally: 5 }), ev('serve', { rally: 6 })]);
    expect(issues.size).toBe(2);
    expect([...issues.values()].every((r) => r === 'Two serves in one rally')).toBe(true);
  });

  it('ignores suggestions (only confirmed events)', () => {
    expect(findIssues([ev('attack', { player_id: null, status: 'suggested' })]).size).toBe(0);
  });
});
