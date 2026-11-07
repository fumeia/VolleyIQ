/** Video sizes the server makes of a match video in the team's storage. */
export type Quality = 'original' | '720' | '480';
export const QUALITIES: { q: Quality; label: string }[] = [
  { q: 'original', label: 'Original' },
  { q: '720', label: '720p' },
  { q: '480', label: '480p' },
];

/** A streaming link with its smaller versions (only those already made). */
export interface VideoLink {
  url: string; expiresIn: number; variants?: Partial<Record<'720' | '480', string>>;
  /** The same files to save instead of play (link valid like the others), with their sizes when known. */
  downloads?: { quality: 'original' | '720' | '480'; url: string; bytes: number | null }[];
}

const key = (who: string) => `viq:quality:${who}`;
const isQuality = (v: unknown): v is Quality => v === 'original' || v === '720' || v === '480';

/** The size last picked on this device ([who]: 'coach' or 'team'), else [fallback]. */
export function loadQuality(who: string, fallback: Quality): Quality {
  try { const v = localStorage.getItem(key(who)); return isQuality(v) ? v : fallback; } catch { return fallback; }
}
export function saveQuality(who: string, q: Quality) {
  try { localStorage.setItem(key(who), q); } catch { /* private mode */ }
}

/** The sizes this link offers (the original always). */
export const available = (link: VideoLink | null | undefined): Quality[] =>
  link ? QUALITIES.map((x) => x.q).filter((q) => q === 'original' || !!link.variants?.[q]) : [];

/** The URL for the wanted size; the original when that size is not made (yet). */
export function urlFor(link: VideoLink, q: Quality): { url: string; quality: Quality } {
  if (q !== 'original' && link.variants?.[q]) return { url: link.variants[q]!, quality: q };
  return { url: link.url, quality: 'original' };
}
