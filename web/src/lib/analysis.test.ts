import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from './api';
import { rotationStats, sideOutPct, breakPct } from './analysis';

const P = (id: number, role: string) => ({ id, role, name: `p${id}`, number: id, active: 1 }) as unknown as Player;
const players = [P(1, 'S'), P(2, 'OH'), P(3, 'MB'), P(4, 'OPP'), P(5, 'OH'), P(6, 'MB')];
let id = 0;
const pt = (action: string, t: number) => ({ id: ++id, match_id: 1, action, t, set_no: 1, status: 'confirmed' }) as VEvent;

describe('rotation analysis', () => {
  it('splits points into side-outs and breaks per setter rotation', () => {
    const lineups = new Map([[1, { 1: { order: [1, 2, 3, 4, 5, 6], weServeFirst: false } }]]);
    // They serve: we side out (kill) -> we rotate, setter to position 6; then we serve and win (ace), then lose.
    const rows = rotationStats([pt('kill', 1), pt('ace', 2), pt('attack_error', 3)], lineups, players);
    expect(rows[0]).toMatchObject({ receiving: 1, sideOuts: 1, serving: 0 });
    expect(rows[5]).toMatchObject({ serving: 2, breaks: 1 });
    expect(sideOutPct(rows[0])).toBe(1);
    expect(breakPct(rows[5])).toBe(0.5);
  });
});

describe('key findings', () => {
  it('says something only with enough data', async () => {
    const { keyFindings } = await import('./analysis');
    const none = keyFindings({ attackEff: 0.2, attempts: 3, recAvg: 2, receptions: 2, aces: 0, serveErrors: 0, serves: 2 }, [], [], [], []);
    expect(none).toEqual([]);
    const some = keyFindings({ attackEff: 0.25, attempts: 40, recAvg: 1.9, receptions: 30, aces: 4, serveErrors: 6, serves: 50 },
      [{ name: '#7 Bea', kills: 12, attempts: 20, eff: 0.4 }], [{ name: '#3 Anna', avg: 1.5, n: 10 }],
      [{ rotation: 1, receiving: 10, sideOuts: 7, serving: 5, breaks: 2 }, { rotation: 2, receiving: 8, sideOuts: 2, serving: 6, breaks: 3 }],
      [{ label: 'Attack errors', value: 9 }, { label: 'Serve errors', value: 6 }]);
    expect(some.map((f) => f.text).join(' ')).toContain('worst in S2');
    expect(some.map((f) => f.text).join(' ')).toContain('#7 Bea led with 12 kills');
    expect(some.map((f) => f.text).join(' ')).toContain('lowest: #3 Anna');
  });
});

describe('zone charts', () => {
  it('groups attacks by origin and passes by reception zone on our half', async () => {
    const { attackOrigins, receptionZones } = await import('./analysis');
    const e = (action: string, fx: number, fy: number, value: number | null = null) => ({ action, fx, fy, value }) as VEvent;
    const o = attackOrigins([e('kill', 1, 7.5), e('attack', 1.5, 8), e('attack_error', 8, 7)]);
    expect(o.find((z) => z.zone === 4)).toMatchObject({ n: 2, good: 1, value: 0.5 });
    expect(o.find((z) => z.zone === 2)).toMatchObject({ n: 1, value: 0 });
    const r = receptionZones([e('receive', 8, 1, 3), e('receive', 8, 2, 1), e('receive', 4.5, 2, 2)]);
    expect(r.find((z) => z.zone === 1)).toMatchObject({ n: 2, value: 2 });
    expect(r.find((z) => z.zone === 6)).toMatchObject({ n: 1, value: 2 });
  });
});
