import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from '../lib/api';
import { attackZones, leaders, longestRuns, matchReport, pointSources, receivers, scoreFlow, setsWon } from './analytics';

let id = 0;
const ev = (action: VEvent['action'], extra: Partial<VEvent> = {}) =>
  ({ id: ++id, match_id: 1, player_id: 1, jersey: 7, action, value: null, zone: null, x: null, y: null, t: id, set_no: 1, source: 'manual', status: 'confirmed', confidence: null, ...extra }) as VEvent;
const p = (pid: number, number: number): Player => ({ id: pid, team_id: 1, name: `P${number}`, number, role: 'OH', active: 1 });

describe('report analytics', () => {
  it('builds the score flow and runs', () => {
    const flow = scoreFlow([ev('kill'), ev('ace'), ev('attack'), ev('serve_error'), ev('opp_error'), ev('kill', { set_no: 2 })]);
    expect(flow.map((f) => f.set)).toEqual([1, 2]);
    expect(flow[0].points.at(-1)).toEqual({ i: 4, us: 3, them: 1 });
    expect(longestRuns(flow[0].points)).toEqual({ us: 2, them: 1 });
  });

  it('counts point sources', () => {
    const s = pointSources([ev('kill'), ev('kill'), ev('opp_point', { player_id: null }), ev('receive', { value: 0 }), ev('receive', { value: 3 })]);
    expect(s.won.find((b) => b.key === 'kill')!.value).toBe(2);
    expect(s.lost.find((b) => b.key === 'rec')!.value).toBe(1);
    expect(s.lost.find((b) => b.key === 'opp')!.value).toBe(1);
  });

  it('derives zones from court points', () => {
    const z = attackZones([ev('kill', { x: 8, y: 10 }), ev('attack_error', { zone: 4 }), ev('attack', { x: 1, y: 17 })]);
    expect(z[3]).toMatchObject({ zone: 4, attempts: 2, kills: 1, errors: 1 });
    expect(z[0]).toMatchObject({ zone: 1, attempts: 1 });
  });

  it('summarises receivers and leaders', () => {
    const players = [p(1, 7), p(2, 9)];
    const events = [ev('receive', { value: 3 }), ev('receive', { value: 1 }), ev('receive', { value: 2, player_id: 2 }), ev('kill', { player_id: 2 })];
    const r = receivers(players, events);
    expect(r[0].player.id).toBe(1);
    expect(r[0].avg).toBe(2);
    const rep = matchReport({ label: 'L', opponent: 'X', played_on: '2026-10-24', team_name: 'U18' }, players, events);
    expect(rep.title).toBe('U18 vs X');
    expect(leaders(rep.rows).find((l) => l.label === 'Kills')!.player.id).toBe(2);
  });

  it('only counts finished sets as won', () => {
    expect(setsWon([{ set: 1, us: 25, them: 20 }, { set: 2, us: 24, them: 25 }, { set: 3, us: 15, them: 13 }])).toEqual({ us: 1, them: 0 });
  });
});
