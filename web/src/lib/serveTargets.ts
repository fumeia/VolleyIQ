import type { Player, VEvent } from './api';
import { zoneOf } from './court';
import { buildRallies } from './sequence';

/**
 * Serve target planner, from a scouted team's tagged matches: for every pass they made, how good
 * it was (0-3) and whether they then won the rally. That gives their side-out chance after each
 * pass grade, and so for each zone and each receiver the side-out chance when we serve there.
 * The gain is how many more points 25 serves there would bring than serving anywhere.
 *
 * Small samples are pulled towards the team's own pass mix, so one bad pass does not make a target.
 */

/** Typical chance to win the rally after a pass graded 0..3 (0 = the pass was the error). */
const PRIOR_WIN = [0.02, 0.38, 0.58, 0.7];
const GRADE_PRIOR = 8;
const MIX_PRIOR = 5;

export interface Target {
  n: number;
  /** Their pass average there. */
  avg: number;
  /** Their side-out chance when served there. */
  sideout: number;
  /** Extra points for us per 25 serves, against serving anywhere. */
  gain: number;
}
export interface ZoneTarget extends Target { zone: number }
export interface ReceiverTarget extends Target { player: Player; zones: { zone: number; n: number }[] }
export interface ComboTarget extends Target { player: Player; zone: number }

export interface ServePlan {
  passes: number;
  /** Their overall side-out chance on a pass (any target). */
  base: number;
  /** Side-out chance after a pass graded 0..3. */
  winAfter: number[];
  zones: ZoneTarget[];
  receivers: ReceiverTarget[];
  /** The best receiver-and-zone pairs. */
  best: ComboTarget[];
}

interface Pass { grade: number; zone: number | null; player: number | null; won: boolean | null }

export function servePlan(players: Player[], events: VEvent[]): ServePlan {
  const passes: Pass[] = [];
  for (const r of buildRallies(events)) {
    const first = r.touches[0];
    if (!first || first.action !== 'receive' || first.value == null) continue;
    const zone = first.fx != null && first.fy != null && first.fy < 9 ? zoneOf({ x: first.fx, y: first.fy }) : null;
    passes.push({ grade: first.value, zone, player: first.player_id, won: r.won });
  }
  // Side-out chance after each grade.
  const winAfter = [0, 1, 2, 3].map((g) => {
    const ps = passes.filter((p) => p.grade === g && p.won != null);
    return (ps.filter((p) => p.won).length + GRADE_PRIOR * PRIOR_WIN[g]) / (ps.length + GRADE_PRIOR);
  });
  const mixOf = (ps: Pass[], prior: number[] | null) => {
    const counts = [0, 1, 2, 3].map((g) => ps.filter((p) => p.grade === g).length);
    const k = prior ? MIX_PRIOR : 0;
    const total = ps.length + k;
    return counts.map((c, g) => (total ? (c + k * (prior?.[g] ?? 0)) / total : 0));
  };
  const teamMix = mixOf(passes, null);
  const sideoutOf = (mix: number[]) => mix.reduce((a, m, g) => a + m * winAfter[g], 0);
  const base = sideoutOf(teamMix);
  const target = (ps: Pass[]): Target => {
    const so = sideoutOf(mixOf(ps, teamMix));
    return { n: ps.length, avg: ps.length ? ps.reduce((a, p) => a + p.grade, 0) / ps.length : 0, sideout: so, gain: (base - so) * 25 };
  };
  const zones = [1, 2, 3, 4, 5, 6].map((zone) => ({ zone, ...target(passes.filter((p) => p.zone === zone)) }));
  const byId = new Map(players.map((p) => [p.id, p]));
  const receivers: ReceiverTarget[] = [...new Set(passes.map((p) => p.player))]
    .filter((id): id is number => id != null && byId.has(id))
    .map((id) => {
      const ps = passes.filter((p) => p.player === id);
      const zs = [1, 2, 3, 4, 5, 6].map((zone) => ({ zone, n: ps.filter((p) => p.zone === zone).length })).filter((z) => z.n).sort((a, b) => b.n - a.n);
      return { player: byId.get(id)!, zones: zs, ...target(ps) };
    })
    .sort((a, b) => b.gain - a.gain);
  const best: ComboTarget[] = [];
  for (const r of receivers) {
    for (const z of r.zones) {
      const ps = passes.filter((p) => p.player === r.player.id && p.zone === z.zone);
      if (ps.length >= 3) best.push({ player: r.player, zone: z.zone, ...target(ps) });
    }
  }
  best.sort((a, b) => b.gain - a.gain);
  return { passes: passes.length, base, winAfter, zones, receivers, best: best.slice(0, 5) };
}
