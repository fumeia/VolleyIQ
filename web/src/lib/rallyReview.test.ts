import { describe, expect, it } from 'vitest';
import type { VEvent } from './api';
import { alreadySaved, duplicates, groupRallies, guessServing, isOurs, outcome, setAt } from './rallyReview';

let id = 0;
const ev = (t: number, extra: Partial<VEvent> = {}) =>
  ({ id: ++id, t, action: 'attack', status: 'suggested', rally: null, poss: null, set_no: null, ...extra }) as VEvent;

describe('rally review', () => {
  it('groups suggestions into rallies with their set', () => {
    const cal = { points: [], ourHalf: 'near' as const, switches: [{ t: 100, ourHalf: 'far' as const }] };
    const { rallies } = groupRallies([ev(1), ev(2), ev(3), ev(110), ev(111)], cal);
    expect(rallies.map((r) => [r.events.length, r.set])).toEqual([[3, 1], [2, 2]]);
    expect(setAt(cal, 99)).toBe(1);
  });

  it('knows whose touches remain once the app dropped the opponent', () => {
    const list = [ev(1, { rally: 7, poss: 1 }), ev(2, { rally: 7, poss: 1 }), ev(3, { rally: 7, poss: 3 })];
    const { info } = groupRallies(list);
    expect(guessServing(list, info)).toBe('them');
    expect(isOurs(info.get(list[0].id), 'them')).toBe(true);
    expect(isOurs(info.get(list[0].id), 'us')).toBe(false);
    const mixed = [...list, ev(4, { rally: 7, poss: 2 })];
    expect(guessServing(mixed, groupRallies(mixed).info)).toBe(null);
  });

  it('turns the last touch into the point or the error', () => {
    expect(outcome({ id: 1, action: 'attack' }, true, true)).toEqual({ change: { id: 1, action: 'kill' } });
    expect(outcome({ id: 1, action: 'attack' }, true, false)).toEqual({ change: { id: 1, action: 'attack_error' } });
    expect(outcome({ id: 2, action: 'serve' }, true, true)).toEqual({ change: { id: 2, action: 'ace' } });
    expect(outcome({ id: 3, action: 'receive' }, true, false)).toEqual({ change: { id: 3, action: 'receive', value: 0 } });
    expect(outcome({ id: 4, action: 'dig' }, true, true)).toEqual({ add: 'opp_error' });
    expect(outcome({ id: 5, action: 'attack' }, false, false)).toEqual({ add: 'opp_point' });
    expect(outcome(null, true, true)).toEqual({ add: 'opp_error' });
  });

  it('folds a touch heard twice into one', () => {
    const a = ev(10, { confidence: 0.6 }), b = ev(10.2, { confidence: 0.4, hint: 'quiet' }), c = ev(11, {}), d = ev(11.1, { jersey: 7 });
    expect(duplicates([a, b, c, d]).sort()).toEqual([b.id, c.id].sort());
  });

  it('folds suggestions of touches that are already saved', () => {
    const a = ev(10), b = ev(12), saved = [ev(10.1, { status: 'confirmed' })];
    expect(alreadySaved([a, b], saved)).toEqual([a.id]);
  });
});
