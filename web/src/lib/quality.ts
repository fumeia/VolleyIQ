import { ACTION_BY_CODE } from './actions';
import type { VEvent } from './api';

/**
 * High-confidence tagging problems worth a second look, keyed by event id with a
 * short reason. Deliberately conservative — only things that are almost always a
 * mistake — so the "things to check" list stays trustworthy and low-noise.
 *
 * Checks (confirmed events only):
 *  - an action that needs a player but has none resolved;
 *  - a serve-receive with no pass grade;
 *  - more than one serve in the same rally (one server per rally).
 */
export function findIssues(events: VEvent[]): Map<number, string> {
  const out = new Map<number, string>();
  const confirmed = events.filter((e) => e.status === 'confirmed');

  for (const e of confirmed) {
    const def = ACTION_BY_CODE[e.action];
    if (def && def.needsPlayer !== false && e.player_id == null) out.set(e.id, 'No player');
    else if (e.action === 'receive' && e.value == null) out.set(e.id, 'Pass grade missing');
  }

  const byRally = new Map<number, VEvent[]>();
  for (const e of confirmed) {
    if (e.rally == null) continue;
    const list = byRally.get(e.rally);
    if (list) list.push(e); else byRally.set(e.rally, [e]);
  }
  for (const list of byRally.values()) {
    const serves = list.filter((e) => e.action === 'serve' || e.action === 'ace' || e.action === 'serve_error');
    if (serves.length > 1) for (const s of serves) if (!out.has(s.id)) out.set(s.id, 'Two serves in one rally');
  }
  return out;
}
