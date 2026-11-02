import { describe, expect, it } from 'vitest';
import type { VEvent } from './api';
import { AVERAGE_TEAM, matchWin, nextRotation, serveWin, simulate, teamRates, type Rates } from './simulate';

let id = 0;
const pt = (action: string, set = 1) => ({ id: ++id, match_id: 1, action, t: id, set_no: set, status: 'confirmed' }) as VEvent;
const flat = (sideout: number, brk: number): Rates => ({ ...AVERAGE_TEAM, sideout: Array(6).fill(sideout), brk: Array(6).fill(brk), overall: { sideout, brk } });

describe('match simulator', () => {
  it('reads side-out and break from who won the rally before', () => {
    // us, us (break), them (we served: lost), them (they served: no side-out), us (side-out)
    const r = teamRates([pt('kill'), pt('ace'), pt('attack_error'), pt('opp_point'), pt('kill')], [], []);
    expect(r.n).toEqual({ serving: 2, receiving: 2 });
    // 1 of 2 each, pulled towards the league (58% / 42%) by 20 pseudo-rallies.
    expect(r.overall.sideout).toBeCloseTo((1 + 20 * 0.58) / 22, 5);
    expect(r.byRotation).toBe(false);
  });

  it('league teams are even; the server wins at the league break rate', () => {
    expect(serveWin(0.42, 0.58)).toBeCloseTo(0.42, 5);
    expect(matchWin(0.5, 0.5)).toBeCloseTo(0.5, 5);
    expect(matchWin(0.6, 0.6)).toBeGreaterThan(0.6);
    const even = simulate(AVERAGE_TEAM, AVERAGE_TEAM, 300);
    expect(even.setWin).toBeGreaterThan(0.42);
    expect(even.setWin).toBeLessThan(0.58);
  });

  it('a better side-out wins more', () => {
    const r = simulate(flat(0.66, 0.42), AVERAGE_TEAM, 200);
    expect(r.setWin).toBeGreaterThan(0.65);
    expect(r.match).toBeGreaterThan(r.setWin);
  });

  it('finds the starting rotation that avoids a weak one', () => {
    const us = flat(0.6, 0.42);
    us.sideout = [0.7, 0.7, 0.7, 0.25, 0.7, 0.7];
    const r = simulate(us, AVERAGE_TEAM, 200);
    expect(r.best).not.toBe(4);
    expect(r.byStart[3]).toBeLessThan(Math.max(...r.byStart));
  });

  it('rotates the setter 1 → 6 → 5', () => {
    expect([1, 6, 5, 2].map(nextRotation)).toEqual([6, 5, 4, 1]);
  });
});
