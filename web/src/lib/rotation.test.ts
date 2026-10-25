import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from './api';
import { candidates, orderAt, pointsOfSet, rotationAfter } from './rotation';

const P = (id: number, role: string) => ({ id, role, name: `p${id}`, number: id, active: 1 }) as unknown as Player;
// 5-1: S in 1, OH 2, MB 3, OPP 4, OH 5, MB 6; libero 7.
const players = [P(1, 'S'), P(2, 'OH'), P(3, 'MB'), P(4, 'OPP'), P(5, 'OH'), P(6, 'MB'), P(7, 'L')];
const lineup = { order: [1, 2, 3, 4, 5, 6], libero: 7, weServeFirst: true };

describe('rotation', () => {
  it('starts with the libero in for the back-row middle', () => {
    const s = rotationAfter(lineup, [], players);
    expect(s.positions).toEqual([1, 2, 3, 4, 5, 7]);
    expect(s.weServe).toBe(true);
  });

  it('rotates on a side-out only', () => {
    // We serve: lose (no rotation, they serve), win (side-out: rotate), win (keep serving).
    const s = rotationAfter(lineup, ['them', 'us', 'us'], players);
    expect(s.turns).toBe(1);
    // Middle 3 rotated... position 1 now holds 2, the middle 6 is in position 5 -> libero.
    expect(s.positions).toEqual([2, 3, 4, 5, 7, 1]);
    expect(candidates(s, 'serve', players).likely).toBe(2);
    expect(candidates(s, 'set', players).likely).toBe(1);
    expect([...candidates(s, 'block_point', players).eligible].sort()).toEqual([3, 4, 5]);
  });

  it('lets the middle serve from position 1', () => {
    // Three side-outs: the middle 6 ... rotation with middle 3 at position 1 while we serve.
    const s = rotationAfter({ ...lineup, weServeFirst: false }, ['us', 'us'], players);
    expect(s.positions[0]).toBe(2);
    const m = rotationAfter({ ...lineup, order: [3, 4, 5, 6, 1, 2], weServeFirst: true }, [], players);
    expect(m.positions[0]).toBe(3); // the middle serves
    expect(rotationAfter({ ...lineup, order: [3, 4, 5, 6, 1, 2], weServeFirst: false }, [], players).positions[0]).toBe(7);
  });

  it('reads who won each rally from the point-ending events', () => {
    const ev = (t: number, action: string, set_no = 1) => ({ t, action, set_no, status: 'confirmed' }) as VEvent;
    expect(pointsOfSet([ev(1, 'kill'), ev(2, 'attack'), ev(3, 'opp_point'), ev(4, 'ace', 2), ev(9, 'kill')], 1, 5)).toEqual(['us', 'them']);
  });

  it('applies substitutions from their time on', () => {
    const subbed = { ...lineup, subs: [{ t: 300, out: 4, in: 8 }, { t: 900, out: 8, in: 4 }] };
    expect(orderAt(subbed, 100)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(orderAt(subbed, 400)).toEqual([1, 2, 3, 8, 5, 6]);
    expect(orderAt(subbed, 1000)).toEqual([1, 2, 3, 4, 5, 6]); // swapped back
    expect(rotationAfter(subbed, [], [...players, P(8, 'OPP')], 400).positions[3]).toBe(8);
  });
});

describe('roleCandidates (no line-up): role-based suggestions', () => {
  it('auto-picks the setter for a set, attackers only for an attack', async () => {
    const { roleCandidates, suggest } = await import('./rotation');
    expect(roleCandidates('set', players).likely).toBe(1); // the S
    const att = [...roleCandidates('attack', players).eligible].sort((a, b) => a - b);
    expect(att).toEqual([2, 3, 4, 5, 6]); // OH/OPP/MB, not the setter (1) or libero (7)
    expect(roleCandidates('dig', players).eligible.has(7)).toBe(true); // libero can dig
    // suggest() uses roles when there is no rotation
    expect(suggest('set', players, null).likely).toBe(1);
    expect(suggest('attack', players, null).eligible.has(7)).toBe(false);
  });

  it('rotation attack eligibility excludes the setter and libero', () => {
    const s = rotationAfter(lineup, [], players); // positions [1,2,3,4,5,7]
    const att = [...candidates(s, 'attack', players).eligible].sort((a, b) => a - b);
    expect(att).toEqual([2, 3, 4, 5]); // on court, attackers only (not S=1, not L=7)
  });
});
