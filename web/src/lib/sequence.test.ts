import { describe, expect, it } from 'vitest';
import type { VEvent } from './api';
import { attackContexts, buildRallies, phaseScoring, realAssists, transitionConversion, winByLength } from './sequence';

let id = 0;
let t = 0;
const ev = (action: VEvent['action'], extra: Partial<VEvent> = {}) =>
  ({ id: ++id, match_id: 1, t: (t += 1), action, value: null, zone: null, x: null, y: null, set_no: 1, status: 'confirmed', player_id: 1, ...extra }) as VEvent;

describe('buildRallies', () => {
  it('splits at scoring tags and knows who served', () => {
    const evs = [
      ev('serve'), ev('dig'), ev('set'), ev('kill'),            // we serve, win
      ev('receive', { value: 3 }), ev('set'), ev('attack_error'), // they serve, we lose
      ev('receive', { value: 1 }), ev('opp_error', { player_id: null }), // they serve, we win on their error
    ];
    const rs = buildRallies(evs);
    expect(rs.map((r) => [r.weServed, r.won, r.touches.length])).toEqual([[true, true, 4], [false, false, 3], [false, true, 1]]);
    const p = phaseScoring(rs);
    expect(p.sideoutPct).toBeCloseTo(0.5);
    expect(p.breakPct).toBe(1);
  });

  it('keeps matches and sets apart', () => {
    const rs = buildRallies([ev('serve', { match_id: 1 }), ev('serve', { match_id: 2 }), ev('serve', { set_no: 2 })]);
    expect(rs).toHaveLength(3);
  });
});

describe('attackContexts', () => {
  it('labels side-out vs transition attacks with the pass/dig quality', () => {
    const rs = buildRallies([
      ev('receive', { value: 2 }), ev('set', { player_id: 5 }), ev('attack'),
      ev('dig', { x: 6, y: 8 }), ev('set', { player_id: 5 }), ev('kill', { player_id: 9 }),
    ]);
    const ctx = attackContexts(rs);
    expect(ctx.map((c) => [c.phase, c.quality, c.set?.player_id])).toEqual([['sideout', 2, 5], ['transition', 3, 5]]);
  });

  it('counts real assists only for a set followed by a kill', () => {
    const rs = buildRallies([
      ev('receive', { value: 3 }), ev('set', { player_id: 5 }), ev('kill'),
      ev('receive', { value: 3 }), ev('assist', { player_id: 7 }), ev('kill'),
      ev('receive', { value: 3 }), ev('set', { player_id: 5 }), ev('attack_error'),
    ]);
    const a = realAssists(rs);
    expect(a.get(5)).toBe(1);
    expect(a.get(7)).toBe(1);
  });
});

describe('rally metrics', () => {
  it('win % by rally length and transition conversion', () => {
    const rs = buildRallies([
      ev('serve'), ev('ace'),                                  // 2 touches... serve+ace = 2, won
      ev('receive', { value: 3 }), ev('set'), ev('kill'),       // 3, won
      ev('receive', { value: 1 }), ev('dig'), ev('set'), ev('attack'), ev('dig'), ev('set'), ev('kill'), // 7, won
      ev('serve'), ev('dig'), ev('dig_error'),                  // 3, lost
    ]);
    const w = winByLength(rs);
    expect(w.find((b) => b.label === '2–3')).toMatchObject({ won: 2, n: 3 });
    expect(w.find((b) => b.label === '7+')).toMatchObject({ won: 1, n: 1 });
    const tc = transitionConversion(rs);
    // digs: (rally3) dig -> attack in play (no kill before next dig) ; dig -> kill ; (rally4) dig -> dig_error is a first contact -> stop
    expect(tc.n).toBe(3);
    expect(tc.kills).toBe(1);
  });
});

describe('transition possessions', () => {
  it('a block touch and the dig after it are one possession, credited with the kill', async () => {
    const { transitionPossessions } = await import('./sequence');
    const rs = buildRallies([ev('serve'), ev('block_touch', { player_id: 4 }), ev('dig', { player_id: 7 }), ev('set'), ev('kill')]);
    const ps = transitionPossessions(rs);
    expect(ps).toHaveLength(1);
    expect(ps[0].result).toBe('kill');
    expect(ps[0].touches.map((e) => e.action)).toEqual(['block_touch', 'dig', 'set', 'kill']);
    expect(transitionConversion(rs)).toMatchObject({ n: 1, kills: 1 });
  });
});

describe('momentum', () => {
  it('finds scoring runs and the score before each rally', async () => {
    const { scoringRuns, withScore } = await import('./sequence');
    // won, lost x4, won
    const rs = buildRallies([ev('ace'), ev('serve_error'), ev('receive', { value: 0 }), ev('opp_point', { player_id: null, value: 3 }), ev('receive', { value: 0 }), ev('opp_point', { player_id: null, value: 3 }), ev('opp_point', { player_id: null }), ev('kill')]);
    const ws = withScore(rs);
    expect(ws.map((x) => `${x.before.us}-${x.before.them}`)).toEqual(['0-0', '1-0', '1-1', '1-2', '1-3', '1-4']);
    const runs = scoringRuns(rs, 4);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ side: 'them', length: 4, from: { us: 1, them: 0 }, to: { us: 1, them: 4 } });
  });
});

describe('how the opponent scored', () => {
  it('reads the kind from the ending tag', async () => {
    const { theirPoint, theirPointSpot } = await import('./sequence');
    expect(theirPoint(ev('dig_error'))).toBe('attack');
    expect(theirPoint(ev('receive', { value: 0 }))).toBe('ace');
    expect(theirPoint(ev('attack_blocked'))).toBe('block');
    expect(theirPoint(ev('serve_error'))).toBe('unforced');
    expect(theirPoint(ev('opp_point', { player_id: null, value: 1 }))).toBe('attack');
    expect(theirPoint(ev('opp_point', { player_id: null, value: 3 }))).toBe('ace');
    expect(theirPoint(ev('opp_point', { player_id: null }))).toBe('unknown');
    expect(theirPointSpot(ev('dig_error', { fx: 2, fy: 3 }))).toEqual({ x: 2, y: 3 });
    expect(theirPointSpot(ev('opp_point', { player_id: null, x: 5, y: 1 }))).toEqual({ x: 5, y: 1 });
  });
});
