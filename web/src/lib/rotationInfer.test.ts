import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from './api';
import { inferRotations, rotationTable } from './rotationInfer';
import { buildRallies } from './sequence';

const P = (id: number, role: string) => ({ id, role, name: `p${id}`, number: id, active: 1 }) as unknown as Player;
// Serve order 1 (S), 2, 3, 4, 5, 6.
const players = [P(1, 'S'), P(2, 'OH'), P(3, 'MB'), P(4, 'OPP'), P(5, 'OH'), P(6, 'MB')];
let id = 0, t = 0;
const ev = (action: VEvent['action'], extra: Partial<VEvent> = {}) =>
  ({ id: ++id, match_id: 1, t: (t += 1), action, value: null, set_no: 1, status: 'confirmed', player_id: 2, ...extra }) as VEvent;

describe('inferRotations', () => {
  it('names rotations by the setter position from the serve order', () => {
    // We receive first (with #6 in position 1) and side out; then each player serves once,
    // loses the rally, and we side out again (so the next one serves).
    const evs: VEvent[] = [ev('receive', { value: 2 }), ev('kill')];
    for (const s of [1, 2, 3, 4, 5, 6]) evs.push(ev('serve', { player_id: s }), ev('attack_error'), ev('receive', { value: 3 }), ev('kill'));
    const rows = inferRotations(buildRallies(evs), players);
    // The very first receive happens with #6 in position 1 -> setter (#1) in position 2: S2.
    expect(rows[0].label).toBe('S2');
    // When the setter serves, it is S1; when #2 serves, the setter stands in position 6: S6.
    expect(rows.find((r) => r.server === 1)?.label).toBe('S1');
    expect(rows.find((r) => r.server === 2)?.label).toBe('S6');
    const table = rotationTable(rows);
    expect(table.map((r) => r.label)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    const s1 = table.find((r) => r.label === 'S1')!;
    expect(s1).toMatchObject({ served: 1, breaks: 0, received: 1, sideouts: 1 });
  });
});
