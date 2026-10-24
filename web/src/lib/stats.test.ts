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
