import { describe, expect, it } from 'vitest';
import { parseRoster } from './roster';

describe('roster paste', () => {
  it('reads number, name and role in any order', () => {
    expect(parseRoster('7 Bea OH\nAnna Meier 12 libero\n#3, Cleo, Middle Blocker\nFia S 5\n\nDana')).toEqual([
      { number: 7, name: 'Bea', role: 'OH' },
      { number: 12, name: 'Anna Meier', role: 'L' },
      { number: 3, name: 'Cleo', role: 'MB' },
      { number: 5, name: 'Fia', role: 'S' },
      { number: null, name: 'Dana', role: 'OH' },
    ]);
  });
});
