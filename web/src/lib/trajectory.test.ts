import { describe, expect, it } from 'vitest';
import type { VEvent } from './api';
import { attackOrigin, depth, direction, eff, errorKind, splitBy, tally, targetDistance, theirZone } from './trajectory';

const E = (action: VEvent['action'], p: Partial<VEvent> = {}) => ({ action, ...p }) as VEvent;

describe('trajectory', () => {
  it('classifies shot direction by angle', () => {
    expect(direction({ fx: 1, fy: 8, x: 1.5, y: 16 })).toBe('line');      // straight down the left line
    expect(direction({ fx: 1, fy: 8, x: 8, y: 16 })).toBe('cross');       // deep cross (~41°)
    expect(direction({ fx: 1, fy: 8, x: 7, y: 10.5 })).toBe('cut');       // sharp along the net
    expect(direction({ fx: 1, fy: 8, x: null, y: null })).toBeNull();
  });

  it('measures depth and error kinds', () => {
    expect(depth({ x: 4, y: 10 })).toBe('short');
    expect(depth({ x: 4, y: 13.5 })).toBe('mid');
    expect(depth({ x: 4, y: 17 })).toBe('deep');
    expect(depth({ x: 4, y: 19 })).toBe('out');
    expect(errorKind(E('attack_error', { x: 4, y: 19.5 }))).toBe('long');
    expect(errorKind(E('attack_error', { x: -1, y: 14 }))).toBe('wide');
    expect(errorKind(E('serve_error', { x: 4, y: 9.1 }))).toBe('net');
    expect(errorKind(E('attack_blocked'))).toBe('blocked');
  });

  it('finds origin and target zones and pass distance', () => {
    expect(attackOrigin({ fx: 1, fy: 8 })).toBe('4');
    expect(attackOrigin({ fx: 4.5, fy: 3 })).toBe('b6');
    // Back-row attackers land in front of the 3 m line (6 m from our baseline): up to 1 m still counts.
    expect(attackOrigin({ fx: 1, fy: 6.8 })).toBe('b5');
    expect(attackOrigin({ fx: 8, fy: 5.5 })).toBe('b1');
    expect(attackOrigin({ fx: 1, fy: 7.1 })).toBe('4');
    expect(theirZone({ x: 8, y: 16 })).toBe(5); // their left-back, our right-deep
    expect(targetDistance({ x: 6, y: 8 })).toBe(0);
  });

  it('tallies efficiency per group', () => {
    const list = [E('kill', { fx: 1, fy: 8 }), E('attack_error', { fx: 1, fy: 8 }), E('attack', { fx: 1, fy: 8 }), E('kill', { fx: 8, fy: 8 })];
    expect(eff(tally(list))).toBeCloseTo(0.25);
    const by = splitBy(list, attackOrigin, ['4', '3', '2', 'b5', 'b6', 'b1']);
    expect(by.get('4')).toEqual({ n: 3, points: 1, errors: 1 });
    expect(by.get('2')).toEqual({ n: 1, points: 1, errors: 0 });
  });
});
