import { describe, expect, it } from 'vitest';
import type { Match, Player, VEvent } from './api';
import { expandPractice } from './practice';
import { changes, findings, hittersByPosition, passers, playerTimeline, setterHitter, setterRows, sideSets } from './practiceAnalysis';

const P = (id: number, number: number, name: string, role: Player['role']): Player => ({ id, number, name, role, active: 1 } as Player);
// 1 Ann S, 2 Bea OH, 3 Cay MB, 4 Dot S, 5 Eve OH, 6 Fay OPP, 7 Lia L
const players = [P(1, 1, 'Ann Set', 'S'), P(2, 2, 'Bea Hit', 'OH'), P(3, 3, 'Cay Mid', 'MB'), P(4, 4, 'Dot Set', 'S'), P(5, 5, 'Eve Hit', 'OH'), P(6, 6, 'Fay Opp', 'OPP'), P(7, 7, 'Lia Lib', 'L')];
let id = 0, t = 0;
const ev = (set: number, side: 'a' | 'b', player: number | null, action: string, value: number | null = null): VEvent =>
  ({ id: ++id, match_id: 9, player_id: player, jersey: null, action, value, zone: null, x: null, y: null, t: t += 1, set_no: set, side, status: 'confirmed' } as unknown as VEvent);

// Set 1: Ann sets Bea (side a, Bea outside). Set 2: Bea moves to Dot's side as opposite; the
// line-ups of set 2 were entered before the sides were swapped (side a's line-up holds side b's players).
// Lia the libero plays in the six in set 2 (no middle left).
const match = {
  id: 9, label: 'Practice', practice: {
    names: { a: 'Near', b: 'Far' },
    sets: { 1: { a: [1, 2, 3, 7], b: [4, 5, 6] }, 2: { a: [1, 3, 5], b: [4, 7, 6, 2] } },
    lineupsB: { 1: { order: [4, 5, 6, null, null, null], libero: null, weServeFirst: false }, 2: { order: [1, 5, 3, null, null, null], libero: null, weServeFirst: true } },
  },
  lineups: {
    1: { order: [1, 2, 3, null, null, null], libero: 7, weServeFirst: true },
    2: { order: [4, 6, 7, 2, null, null], libero: null, weServeFirst: false },
  },
} as unknown as Match;
const raw: VEvent[] = [];
// Set 1, side a: Lia passes 3, Ann sets, Bea kills (x4). Side b: one poor pass, Dot sets, Eve errs.
for (let i = 0; i < 4; i++) raw.push(ev(1, 'b', 6, 'serve'), ev(1, 'a', 7, 'receive', 3), ev(1, 'a', 1, 'set'), ev(1, 'a', 2, 'kill'));
raw.push(ev(1, 'a', 2, 'serve'), ev(1, 'b', 5, 'receive', 1), ev(1, 'b', 4, 'set'), ev(1, 'b', 5, 'attack_error'));
// Set 2, side b: Lia passes 1, Dot sets, Bea errs (x4).
for (let i = 0; i < 4; i++) raw.push(ev(2, 'a', 3, 'serve'), ev(2, 'b', 7, 'receive', 1), ev(2, 'b', 4, 'set'), ev(2, 'b', 2, 'attack_error'));
const events = expandPractice(raw, [match]);

describe('practice match analysis', () => {
  const s = sideSets(match, players, events);
  it("names each side after its setter, scores it from its own view, positions from the line-up", () => {
    const s1 = s.filter((x) => x.set === 1);
    expect(s1.map((x) => x.label)).toEqual(["Ann's side", "Dot's side"]);
    expect(s1.map((x) => [x.pointsFor, x.pointsAgainst])).toEqual([[5, 0], [0, 5]]);
    expect(s1[0].roleOf.get(2)).toBe('OH');
    expect(s1[0].roleOf.get(3)).toBe('MB');
    expect(s1[0].roleOf.get(7)).toBe('L');
    expect(s1[0].sideout).toEqual({ won: 4, n: 4 });
  });
  it('a swapped line-up goes to the side whose players it holds; a libero in the six is the middle there', () => {
    const s2 = s.filter((x) => x.set === 2);
    expect(s2[0].lineup!.order).toEqual([1, 5, 3, null, null, null]);
    expect(s2[1].lineup!.order).toEqual([4, 6, 7, 2, null, null]);
    expect(s2[1].roleOf.get(7)).toBe('MB');
    expect(s2[1].roleOf.get(2)).toBe('OPP');
  });
  it('setters: hitters after their sets, split by the pass before', () => {
    const ann = setterRows(s).find((r) => r.setter === 1)!;
    expect(ann.all).toEqual({ kills: 4, errors: 0, n: 4 });
    expect(ann.good.n).toBe(4);
    const dot = setterRows(s).find((r) => r.setter === 4)!;
    expect(dot.sets).toEqual([1, 2]);
    expect(dot.poor).toEqual({ kills: 0, errors: 5, n: 5 });
    expect(setterHitter(s).find((r) => r.setter === 4 && r.hitter === 2)).toMatchObject({ n: 4, errors: 4 });
  });
  it('hitters by position, passers (libero judged on passes), what changed', () => {
    const bea = hittersByPosition(s).find((h) => h.hitter === 2)!;
    expect(bea.by.OH).toEqual({ kills: 4, errors: 0, n: 4 });
    expect(bea.by.OPP).toEqual({ kills: 0, errors: 4, n: 4 });
    const lia = passers(s).find((r) => r.player === 7)!;
    expect(lia).toMatchObject({ n: 8, perfect: 4 });
    expect(lia.avg).toBe(2);
    expect(lia.after).toEqual({ kills: 4, errors: 4, n: 8 });
    // The libero has a pass number, never an attack or points number.
    expect(playerTimeline(7, s)[0].keys.map((k) => k.kind)).toEqual(['pass']);
    const ch = changes(players, s).find((c) => c.player === 2)!;
    expect(ch.what.join(' ')).toMatch(/Outside → Opposite.*setter #1 Ann → #4 Dot/);
    expect(ch.key).toBe('attack');
    expect(ch.delta).toBe(-2);
  });
  it('findings', () => {
    const f = findings(players, s).map((x) => x.text).join('\n');
    expect(f).toMatch(/Best setter and hitter: #1 Ann setting #2 Bea: 4 kills, 0 errors in 4 attacks/);
    expect(f).toMatch(/#2 Bea with #4 Dot setting: 0 kills, 4 errors in 4 attacks/);
    expect(f).toMatch(/#2 Bea hit better as Outside .* than as Opposite/);
    expect(f).not.toMatch(/Lia.*points/);
  });
});
