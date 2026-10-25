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
