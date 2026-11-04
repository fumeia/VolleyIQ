import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from './api';
import { expandPractice, sideOf, sideScore } from './practice';
import { scoreBySet, playerStats } from './stats';
import { buildRallies } from './sequence';
import { pointSources } from '../report/analytics';

const P = (id: number) => ({ id, name: `#${id}`, number: id, role: 'OH', active: 1 }) as unknown as Player;
let id = 0;
const ev = (action: string, player: number | null, side: 'a' | 'b', extra: Partial<VEvent> = {}) =>
  ({ id: ++id, match_id: 1, action, player_id: player, value: null, t: id, set_no: 1, status: 'confirmed', side, ...extra }) as VEvent;
const practice = { names: { a: 'Blue', b: 'White' }, sets: { 1: { a: [1, 2], b: [3, 4] } } };

describe('practice matches', () => {
  // Blue serves (1), White passes (3), White kills (4): White's point. White serves (3), Blue's #2 attack error: White's point.
  // Then Blue kills (2): Blue's point; and a team point for Blue.
  const events = [
    ev('serve', 1, 'a'), ev('receive', 3, 'b', { value: 2 }), ev('kill', 4, 'b'),
    ev('serve', 3, 'b'), ev('receive', 1, 'a', { value: 1 }), ev('attack_error', 2, 'a'),
    ev('serve', 3, 'b'), ev('receive', 2, 'a', { value: 3 }), ev('kill', 2, 'a'),
    ev('opp_error', null, 'a'),
  ];

  it('knows the sides and scores for the right side', () => {
    expect([sideOf(practice, 1, 1), sideOf(practice, 1, 4), sideOf(practice, 1, 9), sideOf(practice, 2, 1)]).toEqual(['a', 'b', null, null]);
    expect(sideScore({ action: 'kill', side: 'b' })).toBe('them');
    expect(sideScore({ action: 'attack_error', side: 'b' })).toBe('us');
    expect(scoreBySet(events)).toEqual([{ set: 1, us: 2, them: 2 }]);
  });

  it('is analysed from both sides: every touch once for its player, the points from each view', () => {
    const all = expandPractice(events, [{ id: 1, practice }]);
    // The score stays Blue 2 : White 2 (Blue's view).
    expect(scoreBySet(all)).toEqual([{ set: 1, us: 2, them: 2 }]);
    // Player stats count each touch once.
    const stats = playerStats([P(1), P(2), P(3), P(4)], all);
    const of = (pid: number) => stats.find((r) => r.player.id === pid)!.stats;
    expect([of(4).kills, of(2).kills, of(2).attackErrors, of(3).receptions, of(1).serves]).toEqual([1, 1, 1, 1, 1]);
    // Rallies: each side's view separately; 4 rallies each.
    const rallies = buildRallies(all);
    expect(rallies).toHaveLength(8);
    // From White's view, Blue's attack error is a White point won through an opponent error.
    const white = all.filter((e) => e.view === 'b');
    expect(white.filter((e) => e.action === 'opp_error').length).toBe(1);
    expect(white.filter((e) => e.action === 'opp_point').length).toBe(2);
    // Points won, both views together: 2 kills, 2 opponent errors.
    const won = pointSources(all).won;
    expect(won.find((b) => b.key === 'kill')!.value).toBe(2);
    expect(won.find((b) => b.key === 'opp')!.value).toBe(2);
  });

  it('leaves normal matches alone', () => {
    const plain = [ev('kill', 1, 'a', { match_id: 2, side: null })];
    expect(expandPractice(plain, [{ id: 2, practice: null }])).toBe(plain);
  });
});
