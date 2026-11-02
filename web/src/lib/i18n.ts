/**
 * German for the public link (players and parents). The coach app stays English: t() only
 * translates once the public pages switched it on. The language follows the browser until
 * the viewer picks one (remembered on the device).
 */
import { DE } from './de';

export type Lang = 'en' | 'de';
const KEY = 'viq:lang';
let active = false;

export function getLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'de' || v === 'en') return v;
  } catch { /* private mode */ }
  return typeof navigator !== 'undefined' && /^de\b/i.test(navigator.language) ? 'de' : 'en';
}

/** The public pages call this once: from then on t() translates. */
export function publicLanguage() { active = true; }

export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  location.reload();
}

/** The text in the viewer's language; {name} in it is filled from [vars]. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = active && getLang() === 'de' ? DE[text] ?? text : text;
  return vars ? out.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}

/** Is the page in German (for whole German blocks, like the tours)? */
export const isGerman = () => active && getLang() === 'de';
