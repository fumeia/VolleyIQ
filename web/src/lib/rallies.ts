import type { VEvent } from './api';

export interface RallyInfo { rally: string; poss: number }

/** Seconds without a touch that end a rally (same as the app's analysis). */
const MAX_GAP = 3.5;

/**
 * Rally and possession of each suggestion, so "Ours / Theirs" can settle a whole
 * rally. Newer app versions store both; for older suggestions they are rebuilt the
 * same way the app does: a new rally after a long silence, the first touch is the
 * serve, then up to three touches per side.
 */
export function rallyInfo(events: Pick<VEvent, 'id' | 't' | 'rally' | 'poss'>[]): Map<number, RallyInfo> {
  const out = new Map<number, RallyInfo>();
  const rest = [];
  for (const e of events) {
    if (e.rally != null && e.poss != null) out.set(e.id, { rally: String(e.rally), poss: e.poss });
    else if (e.t != null) rest.push(e);
  }
  rest.sort((a, b) => a.t! - b.t!);
  let n = 0, k = 0, last = -Infinity;
  for (const e of rest) {
    if (e.t! - last > MAX_GAP) { n++; k = 0; }
    last = e.t!;
    out.set(e.id, { rally: `~${n}`, poss: k === 0 ? 0 : 1 + Math.floor((k - 1) / 3) });
    k++;
  }
  return out;
}

/** The touches of [ev]'s rally on the other side (ours = true) or on its own side (ours = false). */
export function sideToDrop<E extends { id: number }>(events: E[], info: Map<number, RallyInfo>, ev: E, ours: boolean): E[] {
  const me = info.get(ev.id);
  if (!me) return [];
  return events.filter((e) => {
    const r = info.get(e.id);
    return r != null && r.rally === me.rally && (r.poss % 2 === me.poss % 2) !== ours;
  });
}
