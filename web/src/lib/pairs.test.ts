import { describe, expect, it } from 'vitest';
import type { VEvent } from './api';
import { pairBlocks, pairBlocksOf } from './pairs';
import { scoreBySet, statLine } from './stats';
import { expandPractice } from './practice';

let id = 0;
const ev = (action: string, side: 'a' | 'b', t: number, extra: Partial<VEvent> = {}) =>
  ({ id: ++id, match_id: 1, action, side, t, set_no: 1, status: 'confirmed', player_id: null, value: null, ...extra }) as VEvent;

describe('blocked attack + block point', () => {
  const events = [
    ev('attack_blocked', 'a', 10, { player_id: 3 }),
    ev('block_point', 'b', 10.4, { player_id: 5, fx: 3, fy: 9, x: 4, y: 15 }),
    ev('kill', 'a', 30, { player_id: 3 }),
  ];

  it('is one point for the blocking side, both players keep the play', () => {
    expect(scoreBySet(events)).toEqual([{ set: 1, us: 1, them: 2 }]);
    const paired = pairBlocks(events);
    expect(scoreBySet(paired)).toEqual([{ set: 1, us: 1, them: 1 }]);
    // The attacker keeps the blocked attack as an error, the blocker the point.
    expect(statLine(paired.filter((e) => e.player_id === 3)).attackErrors).toBe(1);
    expect(statLine(paired.filter((e) => e.player_id === 5)).blockPoints).toBe(1);
    // Where it landed, on the attacker's own half.
    expect(paired[0].blockLanding).toEqual({ x: 5, y: 3 });
  });

  it('counts once from both sides of a practice match', () => {
    const m = { id: 1, practice: { names: { a: 'Near', b: 'Far' }, sets: {} }, final: null };
    const all = expandPractice(pairBlocksOf(events, [m]), [m]);
    expect(scoreBySet(all)).toEqual([{ set: 1, us: 1, them: 1 }]);
  });

  it('leaves alone: the same side, a gap, another tag between, and matches marked with older rules', () => {
    expect(pairBlocks([ev('attack_blocked', 'a', 10), ev('block_point', 'a', 10.5)]).some((e) => e.noPoint)).toBe(false);
    expect(pairBlocks([ev('attack_blocked', 'a', 10), ev('block_point', 'b', 20)]).some((e) => e.noPoint)).toBe(false);
    expect(pairBlocks([ev('attack_blocked', 'a', 10), ev('dig', 'b', 10.3), ev('block_point', 'b', 10.6)]).some((e) => e.noPoint)).toBe(false);
    const old = { id: 1, final: { at: '2026-11-01', rules: 1 } };
    expect(pairBlocksOf(events, [old]).some((e) => e.noPoint)).toBe(false);
  });

  it('a block touch that sent the ball out is an error of the blocker, without a point', () => {
    const s = statLine([{ action: 'block_touch', value: 2 }, { action: 'block_touch', value: null }] as VEvent[]);
    expect([s.blockErrors, s.blockTouches, s.errors, s.points]).toEqual([1, 1, 1, 0]);
  });
});
