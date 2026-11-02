import { describe, expect, it } from 'vitest';
import type { Player } from './api';
import { gapOptions, orderWith, type Pt } from './gap';

const sideouts = (start: boolean, pts: Pt[]) => {
  let weServe = start, ours = 0;
  for (const p of pts) { if (p === 'us' && !weServe) ours++; weServe = p === 'us'; }
  return { ours, weServe };
};

describe('catching up the score', () => {
  it('orders the points to end with the right server and number of our side-outs', () => {
    for (const [u, h, start, end, k] of [[5, 3, true, false, 2], [4, 6, false, true, 3], [0, 4, true, false, 0], [3, 0, false, true, 1], [6, 6, true, true, 4]] as const) {
      const pts = orderWith(u, h, start, end, k)!;
      expect(pts.filter((p) => p === 'us')).toHaveLength(u);
      expect(pts.filter((p) => p === 'them')).toHaveLength(h);
      expect(sideouts(start, pts)).toEqual({ ours: k, weServe: end });
    }
  });

  it('refuses what cannot happen', () => {
    expect(orderWith(0, 3, true, true, 0)).toBeNull(); // we served, lost every point, yet serve again
    expect(orderWith(2, 0, false, true, 3)).toBeNull();
  });

  it('offers each reachable rotation once, with a line-up', () => {
    const players = [1, 2, 3, 4, 5, 6].map((id) => ({ id, role: id === 1 ? 'S' : 'OH', name: `p${id}`, number: id, active: 1 }) as unknown as Player);
    const lineup = { order: [1, 2, 3, 4, 5, 6], weServeFirst: true };
    const opts = gapOptions(8, 7, [], null, lineup, players, true);
    expect(new Set(opts.map((o) => o.setter)).size).toBe(opts.length);
    expect(opts.length).toBe(6);
    // Without a line-up there is one way.
    expect(gapOptions(8, 7, [], true, null, players, true)).toHaveLength(1);
  });
});
