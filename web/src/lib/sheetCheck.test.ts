import { describe, expect, it } from 'vitest';
import type { VEvent } from './api';
import { checkAgainstSheet } from './sheetCheck';
import { replaySet, type SheetHalf, type SheetSet } from './sheetFlow';

const half = (start: number[], rounds: (number | 'X' | null)[][]): SheetHalf => ({ start, rounds, subs: [], timeouts: [] });
const set5: SheetSet = {
  set: 1, firstServe: 'A',
  A: half([1, 2, 3, 4, 5, 6], [[0, 4, 9, 15, null, null]]),
  B: half([7, 8, 9, 10, 11, 12], [['X', 3, 6, 13, null, null]]),
};
const sheet = { ourTeam: 'A' as const, sets: [{ a: 15, b: 13 }], flow: [set5] };

let id = 0, t = 0;
const ev = (action: VEvent['action'], extra: Partial<VEvent> = {}) =>
  ({ id: ++id, match_id: 1, t: (t += 1), action, value: null, set_no: 1, status: 'confirmed', player_id: action.startsWith('opp') ? null : 1, ...extra }) as VEvent;

/** Tags for the sheet's points, with [extraAt] extra points for them inserted. */
function tagsFor(extraAt: number[]) {
  const { points } = replaySet(set5, { a: 15, b: 13 });
  const evs: VEvent[] = [];
  points.forEach((p, k) => {
    if (extraAt.includes(k)) evs.push(ev('receive', { value: 2 }), ev('opp_point'));
    evs.push(p.server === 'A' ? ev('serve') : ev('receive', { value: 2 }), p.winner === 'A' ? ev('kill') : ev('opp_point'));
  });
  return evs;
}

describe('check tags against the match sheet', () => {
  it('finds nothing when the tags agree', () => {
    const [c] = checkAgainstSheet(tagsFor([]), sheet);
    expect(c.sheetOk).toBe(true);
    expect(c.tagged).toEqual({ us: 15, them: 13 });
    expect(c.diffs).toEqual([]);
  });

  it('points at two extra points for them', () => {
    const [c] = checkAgainstSheet(tagsFor([10, 20]), sheet);
    expect(c.tagged).toEqual({ us: 15, them: 15 });
    expect(c.sheet).toEqual({ us: 15, them: 13 });
    expect(c.diffs.map((d) => d.kind)).toEqual(['extra', 'extra']);
  });

  it('points at a missing point and one given to the wrong team', () => {
    const evs = tagsFor([]);
    evs.splice(20, 2); // one rally not tagged
    const kill = evs.findIndex((e, k) => k > 30 && e.action === 'kill');
    evs[kill] = { ...evs[kill], action: 'opp_point', player_id: null };
    const [c] = checkAgainstSheet(evs, sheet);
    expect(c.diffs.map((d) => d.kind).sort()).toEqual(['missing', 'wrong']);
  });

  it('still compares point by point when one scanned cell does not add up', () => {
    // Team B's second turn misread as 3 although B already had 4 there: the sheet is off by one point
    // at that spot, but the two extra tagged points elsewhere are still found.
    const misread = { ...sheet, flow: [{ ...set5, B: half([7, 8, 9, 10, 11, 12], [['X', 3, 3, 13, null, null]]) }] };
    const [c] = checkAgainstSheet(tagsFor([4, 30]), misread);
    expect(c.sheetOk).toBe(false);
    expect(c.issues.some((x) => x.text.includes('column III'))).toBe(true);
    expect(c.diffs.filter((d) => d.kind === 'extra').length).toBeGreaterThanOrEqual(2);
    expect(c.diffs.every((d) => d.kind !== 'extra' || !!d.ctx)).toBe(true);
  });
});
