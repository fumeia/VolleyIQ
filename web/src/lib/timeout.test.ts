import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from './api';
import { timeoutBrief } from './timeout';

const P = (id: number) => ({ id, name: `#${id}`, number: id, role: 'OH', active: 1 }) as unknown as Player;
let id = 0;
const ev = (action: string, player: number | null = null, value: number | null = null) =>
  ({ id: ++id, match_id: 1, action, player_id: player, value, t: id, set_no: 2, status: 'confirmed' }) as VEvent;

describe('time-out card', () => {
  it('counts the set, the last rallies, side-out and the talking points', () => {
    const events = [
      ev('kill', 5), ev('kill', 5), ev('kill', 5),
      ev('receive', 7, 1), ev('attack_error', 9), ev('receive', 7, 0), ev('receive', 7, 1), ev('attack_blocked', 9),
      ev('receive', 7, 1), ev('opp_point'), ev('serve_error', 5),
      { ...ev('kill', 9), set_no: 1 },
    ];
    const b = timeoutBrief(events, 2, [P(5), P(7), P(9)]);
    expect(b.score).toEqual({ us: 3, them: 4 });
    expect(b.run).toEqual({ side: 'them', length: 4 });
    expect(b.recent).toMatchObject({ n: 7, won: 3, ourErrors: 3, theirWinners: 1 });
    // A reception error is not a point on its own (the opponent's point is tagged). Rallies 2-7:
    // we served 3 times (won 2), they served 3 times (we won none).
    expect(b.brk).toEqual({ won: 2, n: 3 });
    expect(b.sideout).toEqual({ won: 0, n: 3 });
    const text = b.points.join('\n');
    expect(text).toMatch(/3 of the 4 points lost .* our own errors/);
    expect(text).toMatch(/#7 passes 0\.8 on 4/);
    expect(text).toMatch(/#5 is on: 3 kills in 3/);
    expect(text).toMatch(/They have won the last 4 points/);
  });
});
