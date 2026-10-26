import { describe, expect, it } from 'vitest';
import { scoreBySet, statLine, zoneCounts } from './stats';
import type { VEvent } from './api';

const ev = (action: VEvent['action'], extra: Partial<VEvent> = {}) => ({ action, value: null, zone: null, set_no: 1, ...extra }) as VEvent;

describe('statLine', () => {
  it('computes attack efficiency and serve numbers', () => {
    const s = statLine([ev('kill'), ev('kill'), ev('attack'), ev('attack_error'), ev('ace'), ev('serve'), ev('serve_error')]);
    expect(s.attempts).toBe(4);
    expect(s.attackEff).toBeCloseTo(0.25);
    expect(s.killPct).toBeCloseTo(0.5);
    expect(s.serves).toBe(3);
    expect(s.points).toBe(3);
    expect(s.errors).toBe(2);
  });

  it('averages reception grades and counts 0 as an error', () => {
    const s = statLine([ev('receive', { value: 3 }), ev('receive', { value: 2 }), ev('receive', { value: 0 })]);
    expect(s.recAvg).toBeCloseTo(5 / 3);
    expect(s.recPerfectPct).toBeCloseTo(1 / 3);
    expect(s.recErrors).toBe(1);
  });
});

describe('scoreBySet / zoneCounts', () => {
  it('tracks score per set', () => {
    const sc = scoreBySet([ev('kill'), ev('serve_error'), ev('opp_error'), ev('kill', { set_no: 2 })]);
    expect(sc).toEqual([{ set: 1, us: 2, them: 1 }, { set: 2, us: 1, them: 0 }]);
  });

  it('counts zones for selected actions', () => {
    const z = zoneCounts([ev('kill', { zone: 4 }), ev('kill', { zone: 4 }), ev('attack', { zone: 2 })], ['kill']);
    expect(z[4]).toBe(2);
    expect(z[2]).toBe(0);
  });
});

describe('blocks and court spots', () => {
  it('counts a blocked attack as an attack error and zones from tapped points', () => {
    const s = statLine([ev('kill'), ev('attack_blocked'), ev('attack')]);
    expect(s).toMatchObject({ attempts: 3, attackErrors: 1, blocked: 1, errors: 1 });
    expect(s.attackEff).toBeCloseTo(0);
    const z = zoneCounts([ev('block_point', { x: 1, y: 8 }), ev('dig', { x: 4.5, y: 1 })], ['block_point', 'dig']);
    expect(z[4]).toBe(1);
    expect(z[6]).toBe(1);
  });
});

describe('assists', () => {
  it('a bump set is a set, not an assist; real assists come from set -> kill', async () => {
    const { playerStats } = await import('./stats');
    let i = 0;
    const E = (action: VEvent['action'], player_id: number, extra: Partial<VEvent> = {}) =>
      ({ id: ++i, match_id: 1, t: i, action, value: null, set_no: 1, status: 'confirmed', player_id, ...extra }) as VEvent;
    const players = [{ id: 1, name: 'S', role: 'S', number: 1, active: 1 }, { id: 2, name: 'O', role: 'OH', number: 2, active: 1 }, { id: 3, name: 'L', role: 'L', number: 3, active: 1 }] as never;
    const evs = [
      E('receive', 3, { value: 3 }), E('set', 1), E('kill', 2),          // assist for the setter
      E('receive', 3, { value: 1 }), E('assist', 3), E('attack', 2),     // libero bump set, no kill
    ];
    const rows = playerStats(players, evs);
    const by = (id: number) => rows.find((r) => r.player.id === id)!.stats;
    expect(by(1).assists).toBe(1);
    expect(by(3).assists).toBe(0);
    expect(by(3).bumpSets).toBe(1);
    expect(by(3).points).toBe(0);
  });
});

describe('score with reception errors', () => {
  it('a 0-pass is not a point by itself (it can be rescued); their ace is tagged after it', async () => {
    const { scoreBySet } = await import('./stats');
    const s = scoreBySet([ev('receive', { value: 0 }), ev('dig'), ev('kill'), ev('receive', { value: 0 }), ev('opp_point', { value: 3 })]);
    expect(s[0]).toMatchObject({ us: 1, them: 1 });
  });
});
