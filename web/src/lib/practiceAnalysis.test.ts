import { describe, expect, it } from 'vitest';
import type { Match, Player, VEvent } from './api';
import { expandPractice } from './practice';
import { changes, findings, playerTimeline, setterHitter, sideSets, together } from './practiceAnalysis';

const P = (id: number, number: number, name: string, role: Player['role']): Player => ({ id, number, name, role, active: 1 } as Player);
const players = [P(1, 1, 'Ann Set', 'S'), P(2, 2, 'Bea Hit', 'OH'), P(3, 3, 'Cay Mid', 'MB'), P(4, 4, 'Dot Set', 'S'), P(5, 5, 'Eve Hit', 'OH'), P(6, 6, 'Fay Opp', 'OPP')];
let id = 0;
const ev = (set: number, side: 'a' | 'b', player: number | null, action: string, t: number, value: number | null = null): VEvent =>
  ({ id: ++id, match_id: 9, player_id: player, jersey: null, action, value, zone: null, x: null, y: null, t, set_no: set, side, status: 'confirmed' } as unknown as VEvent);

// Set 1: Ann sets Bea (side a), Dot sets Eve (b). Set 2: Bea moves to Dot's side.
const match = {
  id: 9, label: 'Practice', practice: {
    names: { a: 'Near', b: 'Far' },
    sets: { 1: { a: [1, 2, 3], b: [4, 5, 6] }, 2: { a: [1, 3, 5], b: [4, 2, 6] } },
  },
  lineups: { 1: { order: [1, 2, 3, null, null, null], weServeFirst: true } },
} as unknown as Match;
const raw: VEvent[] = [];
let t = 0;
for (let i = 0; i < 4; i++) { raw.push(ev(1, 'a', 1, 'set', t += 1), ev(1, 'a', 2, 'kill', t += 1)); }
raw.push(ev(1, 'b', 4, 'set', t += 1), ev(1, 'b', 5, 'attack_error', t += 1));
for (let i = 0; i < 4; i++) { raw.push(ev(2, 'b', 4, 'set', t += 1), ev(2, 'b', 2, 'attack_error', t += 1)); }
raw.push(ev(2, 'a', 1, 'set', t += 1), ev(2, 'a', 5, 'kill', t += 1));
const events = expandPractice(raw, [match]);

describe('practice match analysis', () => {
  it('names each side after its setter and scores it from its own view', () => {
    const s = sideSets(match, players, events);
    const s1 = s.filter((x) => x.set === 1);
    expect(s1.map((x) => x.label)).toEqual(['Ann setting', 'Dot setting']);
    expect(s1.map((x) => [x.pointsFor, x.pointsAgainst])).toEqual([[5, 0], [0, 5]]);
    // Positions from the line-up, relative to the setter.
    expect(s1[0].roleOf.get(2)).toBe('OH');
    expect(s1[0].roleOf.get(3)).toBe('MB');
  });
  it('setter and hitter pairs', () => {
    const p = setterHitter(events);
    expect(p.find((r) => r.setter === 1 && r.hitter === 2)).toMatchObject({ attempts: 4, kills: 4, errors: 0 });
    expect(p.find((r) => r.setter === 4 && r.hitter === 2)).toMatchObject({ attempts: 4, kills: 0, errors: 4 });
  });
  it('a player across sets, what changed, and the findings', () => {
    const s = sideSets(match, players, events);
    const tl = playerTimeline(2, s);
    expect(tl.map((x) => [x.set, x.setter, x.line.plusMinus])).toEqual([[1, 1, 4], [2, 4, -4]]);
    const ch = changes(players, s).find((c) => c.player === 2)!;
    expect(ch.what.join(' ')).toMatch(/setter #1 Ann → #4 Dot/);
    expect(ch.delta).toBe(-8);
    expect(together(s).find((x) => x.a === 1 && x.b === 3)).toMatchObject({ sets: 2 });
    const f = findings(players, s, events).map((x) => x.text).join('\n');
    expect(f).toMatch(/Best setter and hitter: #1 Ann setting #2 Bea: 4 kills, 0 errors in 4 attacks/);
    expect(f).toMatch(/#2 Bea with #4 Dot setting: 0 kills, 4 errors/);
  });
});
