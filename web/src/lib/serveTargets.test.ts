import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from './api';
import { servePlan } from './serveTargets';

const P = (id: number) => ({ id, name: `#${id}`, number: id, role: 'OH', active: 1 }) as unknown as Player;
let id = 0;
const ev = (action: string, extra: Partial<VEvent> = {}) => ({ id: ++id, match_id: 1, action, t: id, set_no: 1, status: 'confirmed', player_id: null, value: null, ...extra }) as VEvent;

/** They receive (player, grade, where), then win or lose the rally. */
function rally(player: number, grade: number, at: [number, number], won: boolean) {
  return [ev('receive', { player_id: player, value: grade, fx: at[0], fy: at[1] }), ev('attack', { player_id: 2 }), ev(won ? 'opp_error' : 'opp_point')];
}

describe('serve target planner', () => {
  it('finds the weak passer and zone and what serving there is worth', () => {
    const events: VEvent[] = [];
    for (let i = 0; i < 12; i++) {
      // #7 in zone 1 (their right back: x 6-9, y 0-6) passes 1 and they mostly lose the rally.
      events.push(...rally(7, 1, [7.5, 2], i % 4 === 0));
      // #5 in zone 5 passes 3 and they mostly side out.
      events.push(...rally(5, 3, [1.5, 2], i % 4 !== 0));
    }
    const plan = servePlan([P(5), P(7), P(2)], events);
    expect(plan.passes).toBe(24);
    expect(plan.winAfter[3]).toBeGreaterThan(plan.winAfter[1]);
    expect(plan.receivers[0].player.id).toBe(7);
    expect(plan.receivers[0].gain).toBeGreaterThan(1);
    expect(plan.zones.find((z) => z.zone === 1)!.sideout).toBeLessThan(plan.zones.find((z) => z.zone === 5)!.sideout);
    expect(plan.best[0]).toMatchObject({ zone: 1 });
    expect(plan.best[0].player.id).toBe(7);
  });
});
