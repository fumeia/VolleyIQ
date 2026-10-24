import { describe, expect, it } from 'vitest';
import { fromView, receiveGrade, toView, zoneOf } from './court';

describe('zoneOf', () => {
  it('numbers our half from our perspective', () => {
    expect(zoneOf({ x: 1, y: 8 })).toBe(4);
    expect(zoneOf({ x: 8, y: 7 })).toBe(2);
    expect(zoneOf({ x: 8, y: 1 })).toBe(1);
    expect(zoneOf({ x: 4.5, y: 3 })).toBe(6);
  });

  it('numbers the opponent half from their perspective (mirrored)', () => {
    expect(zoneOf({ x: 8, y: 10 })).toBe(4);   // our right, near the net = their front-left
    expect(zoneOf({ x: 1, y: 10 })).toBe(2);
    expect(zoneOf({ x: 1, y: 17 })).toBe(1);
    expect(zoneOf({ x: 8, y: 17 })).toBe(5);
  });

  it('returns null outside the court', () => {
    expect(zoneOf({ x: -1, y: 12 })).toBeNull();
    expect(zoneOf({ x: 4, y: 19 })).toBeNull();
  });
});

describe('receiveGrade', () => {
  it('grades by distance to the setter target', () => {
    expect(receiveGrade({ x: 6, y: 8 })).toBe(3);
    expect(receiveGrade({ x: 5, y: 6.5 })).toBe(2);
    expect(receiveGrade({ x: 1, y: 2 })).toBe(1);
    expect(receiveGrade({ x: -2, y: 4 })).toBe(0);
    expect(receiveGrade({ x: 5, y: 10 })).toBe(1);
  });
});

describe('view transform', () => {
  it('round-trips', () => {
    for (const half of ['ours', 'theirs'] as const) {
      const p = { x: 3.25, y: half === 'ours' ? 4.5 : 13.5 };
      expect(fromView(half, toView(half, p))).toEqual(p);
    }
  });
});
