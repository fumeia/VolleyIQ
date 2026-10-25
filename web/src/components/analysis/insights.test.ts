import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from '../../lib/api';
import { insightsFor } from './insights';

const P = (id: number, role: string, name: string) => ({ id, role, name, number: id, active: 1 }) as unknown as Player;
const players = [P(1, 'S', 'Sam'), P(2, 'OH', 'Ola'), P(3, 'OH', 'Bea'), P(7, 'L', 'Lin')];
let id = 0, t = 0;
const ev = (action: VEvent['action'], player_id: number | null, extra: Partial<VEvent> = {}) =>
  ({ id: ++id, match_id: 1, t: (t += 1), action, value: null, set_no: 1, status: 'confirmed', player_id, ...extra }) as VEvent;

describe('team insights', () => {
  it('flags a setter feeding the weaker hitter and the opponent serving at a weak passer', () => {
    const evs: VEvent[] = [];
    // #2 gets 14 sets on good passes and converts badly; #3 gets 6 and kills most.
    for (let i = 0; i < 14; i++) evs.push(ev('receive', 7, { value: 3 }), ev('set', 1), ev(i % 3 === 0 ? 'kill' : 'attack_error', 2));
    for (let i = 0; i < 6; i++) evs.push(ev('receive', 7, { value: 3 }), ev('set', 1), ev('kill', 3));
    // #3 passes poorly a lot: they serve at #3.
    for (let i = 0; i < 8; i++) evs.push(ev('receive', 3, { value: 1 }), ev('set', 1), ev('attack', 2), ev('opp_point', null));
    const texts = insightsFor(evs.filter((e) => e.player_id != null), evs, 'team', players).map((i) => i.text);
    expect(texts.some((x) => x.includes('#2 Ola gets the most sets') && x.includes('#3 Bea converts better'))).toBe(true);
    expect(texts.some((x) => x.startsWith('They serve at #3 Bea'))).toBe(true);
  });
});
