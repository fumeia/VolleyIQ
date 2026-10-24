import { describe, expect, it } from 'vitest';
import { rallyInfo, sideToDrop } from './rallies';

describe('rally info', () => {
  it('uses stored rallies and rebuilds missing ones from the timing', () => {
    const ev = [
      { id: 1, t: 1, rally: 4, poss: 0 }, { id: 2, t: 2, rally: 4, poss: 1 },
      // old suggestions without rally numbers: serve, receive, set, attack | dig ... new rally after 5 s
      { id: 3, t: 20, rally: null, poss: null }, { id: 4, t: 21, rally: null, poss: null }, { id: 5, t: 22, rally: null, poss: null },
      { id: 6, t: 23, rally: null, poss: null }, { id: 7, t: 24, rally: null, poss: null }, { id: 8, t: 30, rally: null, poss: null },
    ];
    const info = rallyInfo(ev);
    expect(info.get(1)).toEqual({ rally: '4', poss: 0 });
    expect([3, 4, 5, 6, 7].map((id) => info.get(id)!.poss)).toEqual([0, 1, 1, 1, 2]);
    expect(info.get(8)!.rally).not.toBe(info.get(3)!.rally);
    // Tapping "Ours" on the receive drops the serve and the dig (the other side).
    expect(sideToDrop(ev, info, ev[3], true).map((e) => e.id)).toEqual([3, 7]);
    expect(sideToDrop(ev, info, ev[3], false).map((e) => e.id)).toEqual([4, 5, 6]);
  });
});
