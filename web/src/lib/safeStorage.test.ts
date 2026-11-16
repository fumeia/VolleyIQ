import { beforeEach, describe, expect, it } from 'vitest';

/** A localStorage that holds at most [limit] characters, like the app's WebView (a few MB). */
function fakeStorage(limit: number) {
  const m = new Map<string, string>();
  const size = () => [...m].reduce((a, [k, v]) => a + k.length + v.length, 0);
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = m.get(k);
      m.set(k, v);
      if (size() > limit) { if (before == null) m.delete(k); else m.set(k, before); throw new Error('QuotaExceededError'); }
    },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

describe('saving when the storage is full', () => {
  beforeEach(() => { Object.assign(globalThis, { localStorage: fakeStorage(1000) }); });

  it('drops offline copies to keep a tag that waits to be sent', async () => {
    const { keep, read, storageFull } = await import('./safeStorage');
    localStorage.setItem('viq:cache:/api/teams/1/report', 'x'.repeat(950));
    expect(keep('viq:outbox:5', JSON.stringify([{ client_id: 'a', action: 'dig' }]))).toBe(true);
    expect(read('viq:outbox:5')).toContain('dig');
    expect(localStorage.getItem('viq:cache:/api/teams/1/report')).toBeNull();
    expect(storageFull()).toBe(false);
  });

  it('keeps it in memory when even that is not enough, and says so', async () => {
    const { keep, read, storageFull } = await import('./safeStorage');
    localStorage.setItem('viq:token', 't'.repeat(950));
    expect(keep('viq:outbox:6', 'y'.repeat(200))).toBe(false);
    expect(read('viq:outbox:6')).toBe('y'.repeat(200));
    expect(storageFull()).toBe(true);
  });
});
