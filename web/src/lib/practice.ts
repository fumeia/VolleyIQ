import { scoreOf, type ActionCode } from './actions';
import type { Match, Practice, VEvent } from './api';
import type { Lineups } from './rotation';

/**
 * Practice matches: both sides are our own players, picked anew each set. Every tag says which
 * side it is (side "a" or "b"); a point of side b counts against side a in the score. Court spots
 * are saved from the player's own half (the court is drawn turned for side b), so all touches sit
 * on the same field in the analysis.
 *
 * For the analysis a practice match is seen from both sides, like two matches: side a's view has
 * a's touches, with b's winners and errors as the opponent's points; side b's view the same the
 * other way round. Every touch counts once for its player.
 */

export type Side = 'a' | 'b';

/** Which side a player is on in a set (null: not playing in it). */
export function sideOf(practice: Practice | null | undefined, set: number, playerId: number | null | undefined): Side | null {
  const s = practice?.sets[String(set)];
  if (!s || playerId == null) return null;
  return s.a.includes(playerId) ? 'a' : s.b.includes(playerId) ? 'b' : null;
}

/** Point for "us" (side a) or "them" (side b), from a tag of either side. */
export function sideScore(e: { action: ActionCode; value?: number | null; side?: Side | null; view?: Side }): 'us' | 'them' | undefined {
  const s = scoreOf(e);
  if (!s || e.view || e.side !== 'b') return s;
  return s === 'us' ? 'them' : 'us';
}

/** The other side's view of a point: the opponent scored (opp_point) or erred (opp_error). */
const mirror = (e: VEvent, view: Side, id: number): VEvent => ({
  ...e, id, player_id: null, jersey: null, value: null, zone: null, x: null, y: null, fx: null, fy: null,
  action: (scoreOf(e) === 'us' ? 'opp_point' : 'opp_error') as ActionCode, view, ai: null,
});

/** Events of a team's matches, with every practice match turned into its two views (see above). */
export function expandPractice(events: VEvent[], matches: Pick<Match, 'id' | 'practice'>[]): VEvent[] {
  const practice = new Set(matches.filter((m) => m.practice).map((m) => m.id));
  if (!practice.size) return events;
  const out: VEvent[] = [];
  for (const e of events) {
    if (!practice.has(e.match_id)) { out.push(e); continue; }
    const own: Side = e.side === 'b' ? 'b' : 'a';
    out.push({ ...e, view: own });
    if (scoreOf(e)) out.push(mirror(e, own === 'a' ? 'b' : 'a', -Math.abs(e.id) - 1e9));
  }
  return out;
}

/**
 * Line-ups for the analysis: the match's own per set ("1".."5"), and in a practice match the second
 * side's as "b1".."b5" (its view of the match is analysed with them).
 */
export function lineupsOf(m: Pick<Match, 'lineups' | 'practice'>): Lineups | null {
  const b = m.practice?.lineupsB;
  if (!b) return m.lineups ?? null;
  return { ...(m.lineups ?? {}), ...Object.fromEntries(Object.entries(b).map(([k, v]) => [`b${k}`, v])) };
}

/** A season without its practice matches (both sides ours would skew the team's numbers), unless [include]. */
export function seasonScope<M extends Pick<Match, 'id' | 'practice'>, E extends Pick<VEvent, 'match_id'>>(matches: M[], events: E[], include: boolean): { matches: M[]; events: E[]; practiceCount: number } {
  const practiceCount = matches.filter((m) => m.practice).length;
  if (include || !practiceCount) return { matches, events, practiceCount };
  const keep = new Set(matches.filter((m) => !m.practice).map((m) => m.id));
  return { matches: matches.filter((m) => keep.has(m.id)), events: events.filter((e) => keep.has(e.match_id)), practiceCount };
}
