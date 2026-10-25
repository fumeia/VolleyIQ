import { describe, expect, it } from 'vitest';
import { linear, niceTicks } from './scale';

describe('chart scales', () => {
  it('maps linearly', () => {
    const s = linear(0, 10, 100, 200);
    expect(s(5)).toBe(150);
  });
  it('makes nice ticks that cover the range', () => {
    expect(niceTicks(0, 25, 5)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(niceTicks(-0.2, 0.45, 4)).toEqual([-0.2, 0, 0.2, 0.4, 0.6]);
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const t = niceTicks(3, 3);
    expect(t.length).toBeGreaterThanOrEqual(2);
  });
});
