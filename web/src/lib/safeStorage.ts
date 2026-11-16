/**
 * Saving to the app's web storage (localStorage, a few MB) without losing anything when it is full.
 * Offline copies of server answers (viq:cache:…) are the first to go: they can be fetched again.
 * What still does not fit stays in memory for as long as the app is open (unsent tags are then
 * still sent), and [storageFull] says so.
 */
export const CACHE_PREFIX = 'viq:cache:';
const mem = new Map<string, string>();

function cacheKeys(): { k: string; n: number }[] {
  const out: { k: string; n: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) out.push({ k, n: localStorage.getItem(k)?.length ?? 0 });
    }
  } catch { /* storage unavailable */ }
  return out.sort((a, b) => b.n - a.n);
}

/** Removes offline copies, largest first, until they take at most [maxChars] (0: all of them). */
export function trimCache(maxChars = 0) {
  const keys = cacheKeys();
  let total = keys.reduce((a, x) => a + x.n, 0);
  for (const { k, n } of keys) {
    if (total <= maxChars) break;
    try { localStorage.removeItem(k); } catch { /* storage unavailable */ }
    total -= n;
  }
}

/** Stores [value]; when the storage is full, drops the offline copies and tries again. False: kept in memory only. */
export function keep(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); mem.delete(key); return true; } catch { /* full: make room */ }
  trimCache(0);
  try { localStorage.setItem(key, value); mem.delete(key); return true; } catch { /* still full */ }
  mem.set(key, value);
  return false;
}

export function read(key: string): string | null {
  if (mem.has(key)) return mem.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Something could only be kept in memory: it is lost when the app is closed. */
export const storageFull = () => mem.size > 0;
