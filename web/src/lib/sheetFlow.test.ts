import { describe, expect, it } from 'vitest';
import type { Player } from './api';
import { inColumn, replaySet, sheetStats, turnEnds, type SheetHalf, type SheetSet } from './sheetFlow';

const half = (start: number[], rounds: (number | 'X' | null)[][], subs: SheetHalf['subs'] = []): SheetHalf => ({ start, rounds, subs, timeouts: [] });

describe('match sheet flow', () => {
  it('reads service turns in order, skipping the receiving team\'s crossed first cell', () => {
    expect(turnEnds(half([], [[0, 3, 5, null, null, null]]), true)).toEqual([0, 3, 5]);
    expect(turnEnds(half([], [['X', 2, 4, null, null, null]]), false)).toEqual([2, 4]);
  });

  it('replays a set point by point and checks it against the final score', () => {
    // A serves first and loses it at once (0); B side-outs, serves with column II up to 3;
    // A side-outs (1-3), column II serves to 4, and so on until 15-13 in a fifth set.
    const s: SheetSet = {
      set: 5, firstServe: 'A',
      A: half([1, 2, 3, 4, 5, 6], [[0, 4, 9, 15, null, null]]),
      B: half([7, 8, 9, 10, 11, 12], [['X', 3, 6, 13, null, null]]),
    };
    const { points, ok } = replaySet(s, { a: 15, b: 13 });
    expect(ok).toBe(true);
    expect(points[0]).toMatchObject({ server: 'A', winner: 'B', score: { A: 0, B: 1 } });
    // B's first server is column II, and B stays in that rotation while scoring.
    expect(points[1]).toMatchObject({ server: 'B', winner: 'B', slot: { A: 0, B: 1 } });
    expect(points.at(-1)!.score).toEqual({ A: 15, B: 13 });
    // A misread cell no longer adds up.
    expect(replaySet(s, { a: 15, b: 11 }).ok).toBe(false);
    // A misread middle cell (a turn ending below the score the team already had) is caught
    // even though the set still ends on the final score.
    const misread: SheetSet = { ...s, A: half([1, 2, 3, 4, 5, 6], [[0, 4, 3, 15, null, null]]) };
    expect(replaySet(misread, { a: 15, b: 13 }).ok).toBe(false);
  });

  it('tracks substitutes and counts side-outs and breaks per rotation', () => {
    const h = half([1, 2, 3, 4, 5, 6], [[0, 4, 9, 15, null, null]], [{ col: 2, in: 20, own: 3, opp: 5 }]);
    expect(inColumn(h, 1, 1, 1)).toBe(2);
    expect(inColumn(h, 1, 4, 6)).toBe(20);
    const players = [{ id: 1, number: 1, role: 'S', name: 's', active: 1 }] as unknown as Player[];
    const s: SheetSet = { set: 5, firstServe: 'A', A: h, B: half([7, 8, 9, 10, 11, 12], [['X', 3, 6, 13, null, null]]) };
    const st = sheetStats([{ ourTeam: 'A', sets: [{ a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }, { a: 15, b: 13 }], flow: [s] }], players);
    expect(st.sets).toBe(1);
    const s1 = st.rotations.find((r) => r.label === 'S1')!;
    // Setter (#1, column I) in position I: we served the first point and lost it.
    expect(s1.served).toBeGreaterThan(0);
    const total = st.rotations.reduce((a, r) => a + r.breaks + r.sideouts, 0);
    expect(total).toBe(15);
    expect(st.servers.reduce((a, x) => a + x.won, 0)).toBe(st.rotations.reduce((a, r) => a + r.breaks, 0));
  });
});
