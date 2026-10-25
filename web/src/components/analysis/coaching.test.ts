import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from '../../lib/api';
import { playerCoaching } from './coaching';

const P = (id: number, role: string, name: string) => ({ id, role, name, number: id, active: 1 }) as unknown as Player;
const players = [P(1, 'S', 'Sam'), P(2, 'OH', 'Ola'), P(7, 'L', 'Lin')];
let id = 0, t = 0;
const ev = (action: VEvent['action'], player_id: number | null, extra: Partial<VEvent> = {}) =>
  ({ id: ++id, match_id: 1, t: (t += 1), action, value: null, set_no: 1, status: 'confirmed', player_id, ...extra }) as VEvent;

describe('player coaching', () => {
  it('turns the data into faults with a matching suggestion, and keeps strengths', () => {
    const evs: VEvent[] = [];
    // Ola: attacks into the net a lot, passes well.
    for (let i = 0; i < 10; i++) evs.push(ev('receive', 2, { value: 3 }), ev('set', 1), ev(i < 6 ? 'attack_error' : 'kill', 2, { x: 4.5, y: 9 }));
    const c = playerCoaching(players[1], evs, players);
    expect(c.faults.some((f) => f.key === 'attack')).toBe(true);
    expect(c.strengths.some((f) => f.key === 'pass')).toBe(true);
    expect(c.suggestions.length).toBeGreaterThan(0);
    expect(c.suggestions.every((s) => s.why && s.how)).toBe(true);
  });

  it('gives the setter setter-specific findings', () => {
    const evs: VEvent[] = [];
    for (let i = 0; i < 20; i++) evs.push(ev('receive', 7, { value: 2 }), ev(i < 3 ? 'set_error' : 'set', 1));
    const c = playerCoaching(players[0], evs, players);
    expect(c.faults.some((f) => f.key === 'set-err')).toBe(true);
    expect(c.suggestions.some((s) => s.title === 'Set errors')).toBe(true);
  });
});
