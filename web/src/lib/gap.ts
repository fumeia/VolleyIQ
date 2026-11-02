import type { Player } from './api';
import { rotationAfter, type Lineup } from './rotation';

/**
 * Catching up after a break in live tagging: the score moved on while nobody tagged, so the
 * missing points are added as "not tagged" points. Their order is unknown, but it decides who
 * serves and how far each team rotated; so they are put in an order that ends with what the
 * coach sees on court now (who serves, and our rotation when the line-up is entered).
 */

export type Pt = 'us' | 'them';

/**
 * [u] points for us and [h] for them, starting with [weServe], with exactly [k] of our side-outs,
 * ending with [endServe]. Null when no order can do that.
 */
export function orderWith(u: number, h: number, weServe: boolean, endServe: boolean, k: number): Pt[] | null {
  // Side-outs alternate: theirs (m) follow from ours (k) and who serves at the start and the end.
  const m = weServe === endServe ? k : weServe ? k + 1 : k - 1;
  if (k < 0 || m < 0 || k > u || m > h) return null;
  let usBreaks = u - k, themBreaks = h - m;
  const phases = k + m + 1;
  const out: Pt[] = [];
  let serving: Pt = weServe ? 'us' : 'them';
  for (let i = 0; i < phases; i++) {
    if (i > 0) out.push(serving); // the side-out that started this phase
    // Every break point of a team goes into its first serving phase.
    if (serving === 'us' && usBreaks) { out.push(...Array<Pt>(usBreaks).fill('us')); usBreaks = 0; }
    if (serving === 'them' && themBreaks) { out.push(...Array<Pt>(themBreaks).fill('them')); themBreaks = 0; }
    serving = serving === 'us' ? 'them' : 'us';
  }
  return usBreaks || themBreaks ? null : out;
}

/** Who serves after a run of points (the winner of the last one), or [start] if there are none. */
const serveAfter = (points: Pt[], start: boolean) => (points.length ? points[points.length - 1] === 'us' : start);

export interface GapOption {
  points: Pt[];
  /** Our setter's court position after these points (null without a line-up or a setter). */
  setter: number | null;
  /** Who stands in position 1 for us after these points (player id). */
  inOne: number | null;
}

/**
 * Every distinct way the missing points can leave the court: per who serves now and (with a
 * line-up) our rotation. [before] are the set's points so far.
 */
export function gapOptions(u: number, h: number, before: Pt[], weServedFirst: boolean | null, lineup: Lineup | null, players: Player[], endServe: boolean): GapOption[] {
  const start = serveAfter(before, lineup?.weServeFirst ?? weServedFirst ?? true);
  const seen = new Set<string>();
  const out: GapOption[] = [];
  for (let k = 0; k <= u; k++) {
    const points = orderWith(u, h, start, endServe, k);
    if (!points) continue;
    let setter: number | null = null, inOne: number | null = null;
    if (lineup) {
      const state = rotationAfter(lineup, [...before, ...points], players);
      const s = state.positions.findIndex((id) => players.find((p) => p.id === id)?.role === 'S');
      setter = s >= 0 ? s + 1 : null;
      inOne = state.positions[0] ?? null;
    }
    const key = lineup ? `${setter}:${inOne}` : 'any';
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ points, setter, inOne });
    if (!lineup) break;
  }
  return out;
}
