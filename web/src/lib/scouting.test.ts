import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from './api';
import { scoutingReport } from './scouting';

const P = (id: number, role: string) => ({ id, role, name: `#${id}`, number: id, active: 1 }) as unknown as Player;
const players = [P(1, 'S'), P(2, 'OH'), P(3, 'MB'), P(4, 'OPP'), P(5, 'OH'), P(6, 'MB')];
let id = 0;
let t = 0;
const ev = (action: string, player: number | null, extra: Partial<VEvent> = {}) =>
  ({ id: ++id, match_id: 1, action, player_id: player, t: ++t, set_no: 1, status: 'confirmed', value: null, ...extra }) as VEvent;

/** A rally on their serve: the pass (grade), a set, then #attacker hits from (fx, fy) to (x, y). */
function sideOut(passer: number, grade: number, attacker: number, from: [number, number], to: [number, number], end: string) {
  return [ev('receive', passer, { value: grade }), ev('set', 1), ev(end, attacker, { fx: from[0], fy: from[1], x: to[0], y: to[1] })];
}

describe('scouting report', () => {
  it('finds the weak passer, the main hitter and the setter habit', () => {
    const events: VEvent[] = [];
    for (let i = 0; i < 10; i++) {
      // #5 passes badly; after a bad pass the ball goes to #2 in zone 4, cross-court.
      events.push(...sideOut(5, i < 8 ? 1 : 2, 2, [1, 7.5], [6, 15], i % 2 ? 'kill' : 'attack'));
      // #2 passes well; the good passes go to the middle and to #4 on the right.
      events.push(...sideOut(2, 3, i % 2 ? 3 : 4, i % 2 ? [4.5, 8] : [8, 7.5], [3, 14], 'attack'));
    }
    const r = scoutingReport(players, events, [{ id: 1, lineups: null }]);
    expect(r.receivers[0].player.id).toBe(5);
    expect(r.attackers[0]).toMatchObject({ attempts: 10, kills: 5 });
    expect(r.attackers[0].player.id).toBe(2);
    expect(r.attackers[0].origins[0].key).toBe('4');
    expect(r.attackers[0].dirs.cross).toBe(10);
    expect(r.setter.bad.to['4']).toBe(8);
    expect(r.plan.join('\n')).toMatch(/Serve at #5/);
    expect(r.plan.join('\n')).toMatch(/#2 takes 50% of their attacks .* mostly from zone 4; 100% cross shots/);
    expect(r.plan.join('\n')).toMatch(/After a bad pass or dig, 100% of their sets go to zone 4/);
  });

  it('says nothing from a handful of touches', () => {
    const r = scoutingReport(players, sideOut(5, 1, 2, [1, 7.5], [6, 15], 'kill'), []);
    expect(r.plan).toEqual([]);
  });
});
