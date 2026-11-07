import type { Match, VEvent } from './api';

/**
 * How the tags are read for scores and stats. When the reading changes, RULES goes up; a match
 * marked "fully tagged" keeps the rules it was marked with (its score and stats do not change by
 * themselves), every other match follows the newest.
 * 1: every scoring tag is a point.
 * 2: a blocked attack followed by the other side's block point is one point (pairBlocks).
 * 3: a kill and the other side's dig error right next to it are one point (pairBlocks).
 */
export const RULES = 3;
export const rulesOf = (m?: Pick<Match, 'final'> | null) => m?.final?.rules ?? RULES;

const sideOf = (e: VEvent) => (e.side === 'b' ? 'b' : 'a');
const byTime = (a: VEvent, b: VEvent) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.id - b.id;

/**
 * Two tags of one rally ending that would otherwise score twice (rules 3+, see RULES above):
 * a kill and the other side's dig error right next to it (within 3 s, either order) score once.
 *
 * A blocked attack ("Attack blocked") whose next tag in the set is the other side's block point
 * (within 3 s) is one rally ending, not two points: the block point scores, the blocked attack stays
 * the attacker's error without a point of its own. Both players keep the play in their stats, and
 * where the block point landed goes with the blocked attack (seen from the attacker's half) for the
 * cover chart. Matches whose rules are older than 2 are left as they are.
 */
export function pairBlocks(events: VEvent[], rulesFor: (matchId: number) => number = () => RULES): VEvent[] {
  const changed = new Map<number, VEvent>();
  const groups = new Map<string, VEvent[]>();
  for (const e of events) {
    if (e.status !== 'confirmed' || e.view) continue;
    if (rulesFor(e.match_id) < 2) continue;
    const k = `${e.match_id}:${e.set_no ?? 1}`;
    const g = groups.get(k);
    if (g) g.push(e); else groups.set(k, [e]);
  }
  for (const list of groups.values()) {
    list.sort(byTime);
    const rules = rulesFor(list[0].match_id);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      // A kill the other side dug but could not keep in play (out, wall, ceiling): the kill scores,
      // the dig error stays the defender's error without a point of its own. Either order, as the
      // two can be tagged a moment apart either way; the dig error is read just before the kill so
      // it ends up in the same rally.
      if (rules >= 3 && sideOf(a) !== sideOf(b) && (a.t == null || b.t == null || b.t - a.t <= 3)
        && ((a.action === 'kill' && b.action === 'dig_error') || (a.action === 'dig_error' && b.action === 'kill'))) {
        const [kill, dig] = a.action === 'kill' ? [a, b] : [b, a];
        if (changed.has(kill.id) || changed.has(dig.id)) continue;
        changed.set(dig.id, { ...dig, noPoint: true, ...(dig === b && kill.t != null ? { t: kill.t - 0.001 } : {}) });
        i++;
        continue;
      }
      if (a.action !== 'attack_blocked' || b.action !== 'block_point' || sideOf(a) === sideOf(b)) continue;
      if (a.t != null && b.t != null && b.t - a.t > 3) continue;
      // Where the block point landed, on the attacker's own half (the blocker tapped it on the other half).
      const landing = b.fx != null && b.x != null && b.y != null ? { x: 9 - b.x, y: 18 - b.y } : null;
      changed.set(a.id, { ...a, noPoint: true, ...(landing ? { blockLanding: landing } : {}) });
    }
  }
  return changed.size ? events.map((e) => changed.get(e.id) ?? e) : events;
}

/** pairBlocks for the events of several matches, each with its own rules. */
export function pairBlocksOf(events: VEvent[], matches: Pick<Match, 'id' | 'final'>[]): VEvent[] {
  const rules = new Map(matches.map((m) => [m.id, rulesOf(m)]));
  return pairBlocks(events, (id) => rules.get(id) ?? RULES);
}
