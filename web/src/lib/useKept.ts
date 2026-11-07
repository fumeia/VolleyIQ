import { useEffect, useState } from 'react';

/**
 * useState that is kept for this visit (session storage): a choice made on a page is still there
 * after going to another tab and back. Gone when the browser tab or the app is closed.
 * [valid] drops a saved value that no longer fits (e.g. a match that is gone); [force], when given,
 * wins over the saved value (e.g. a page opened for one match).
 */
export function useKept<T>(key: string, initial: T, valid: (v: T) => boolean = () => true, force?: T) {
  const [value, setValue] = useState<T>(() => {
    if (force !== undefined) return force;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw != null) { const v = JSON.parse(raw) as T; if (valid(v)) return v; }
    } catch { /* private mode or blocked storage: start fresh */ }
    return initial;
  });
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept, still works */ }
  }, [key, value]);
  return [value, setValue] as const;
}
