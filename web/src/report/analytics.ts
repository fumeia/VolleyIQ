import { tagOrder } from '../lib/actions';
import { sideScore } from '../lib/practice';
import { type ActionCode } from '../lib/actions';
import type { Match, Player, VEvent } from '../lib/api';
import { zoneOf } from '../lib/court';
import { playerStats, scoreBySet, statLine, type StatLine } from '../lib/stats';
import { fmtEff } from './ui';

/** Everything the report cards need, derived from confirmed tags only. */

const byTime = (a: VEvent, b: VEvent) => (a.set_no ?? 1) - (b.set_no ?? 1) || (a.t ?? 1e12) - (b.t ?? 1e12) || tagOrder(a.id) - tagOrder(b.id);

export interface FlowPoint { i: number; us: number; them: number }

/** Running score per set, one step per point-ending tag. */
export function scoreFlow(events: VEvent[]): { set: number; points: FlowPoint[] }[] {
  const sets = new Map<number, FlowPoint[]>();
  for (const e of [...events].sort(byTime)) {
    if (e.view === 'b') continue;
    const effect = sideScore(e);
    if (!effect) continue;
    const s = e.set_no ?? 1;
    const pts = sets.get(s) ?? [{ i: 0, us: 0, them: 0 }];
    const last = pts[pts.length - 1];
    pts.push({ i: last.i + 1, us: last.us + (effect === 'us' ? 1 : 0), them: last.them + (effect === 'them' ? 1 : 0) });
    sets.set(s, pts);
  }
  return [...sets.entries()].sort((a, b) => a[0] - b[0]).map(([set, points]) => ({ set, points }));
}

/** Longest run of consecutive points for each side, per set. */
export function longestRuns(flow: FlowPoint[]) {
  let us = 0, them = 0, curUs = 0, curThem = 0;
  for (let k = 1; k < flow.length; k++) {
    if (flow[k].us > flow[k - 1].us) { curUs++; curThem = 0; } else { curThem++; curUs = 0; }
    us = Math.max(us, curUs);
    them = Math.max(them, curThem);
  }
  return { us, them };
}

export interface Bar { key: string; label: string; value: number }

/** How our points were won and how the opponent's points came about. */
export function pointSources(events: VEvent[]): { won: Bar[]; lost: Bar[] } {
  const n = (codes: ActionCode[], f: (e: VEvent) => boolean = () => true) =>
    events.filter((e) => codes.includes(e.action) && f(e)).length;
  const won: Bar[] = [
    { key: 'kill', label: 'Attack kills', value: n(['kill']) },
    { key: 'ace', label: 'Serve aces', value: n(['ace']) },
    { key: 'block', label: 'Block points', value: n(['block_point']) },
    { key: 'opp', label: 'Opponent errors', value: n(['opp_error']) },
  ];
  const lost: Bar[] = [
    { key: 'opp', label: 'Opponent winners', value: n(['opp_point']) },
    { key: 'att', label: 'Attack errors', value: n(['attack_error']) },
    { key: 'blk', label: 'Got blocked', value: n(['attack_blocked']) },
    { key: 'srv', label: 'Serve errors', value: n(['serve_error']) },
    { key: 'rec', label: 'Reception errors', value: n(['receive'], (e) => e.value === 0) },
    { key: 'def', label: 'Block / dig errors', value: n(['block_error', 'dig_error']) },
    { key: 'set', label: 'Setting errors', value: n(['assist_error', 'set_error']) },
  ];
  return { won, lost };
}

const zoneFor = (e: VEvent) => e.zone ?? (e.x != null && e.y != null ? zoneOf({ x: e.x, y: e.y }) : null);

export interface ZoneStat { zone: number; attempts: number; kills: number; errors: number }

/** Attack results by target zone (opponent court). */
export function attackZones(events: VEvent[]): ZoneStat[] {
  const out = [1, 2, 3, 4, 5, 6].map((zone) => ({ zone, attempts: 0, kills: 0, errors: 0 }));
  for (const e of events) {
    if (!['kill', 'attack', 'attack_error'].includes(e.action)) continue;
    const z = zoneFor(e);
    if (!z) continue;
    const s = out[z - 1];
    s.attempts++;
    if (e.action === 'kill') s.kills++;
    if (e.action === 'attack_error') s.errors++;
  }
  return out;
}

export interface PlayerRow { player: Player; stats: StatLine; count: number }

export interface ReceiverRow { player: Player; grades: [number, number, number, number]; avg: number | null }

export function receivers(players: Player[], events: VEvent[]): ReceiverRow[] {
  return players
    .map((player) => {
      const grades: [number, number, number, number] = [0, 0, 0, 0];
      for (const e of events) if (e.player_id === player.id && e.action === 'receive' && e.value != null) grades[e.value]++;
      const n = grades.reduce((a, b) => a + b, 0);
      return { player, grades, avg: n ? (grades[1] + 2 * grades[2] + 3 * grades[3]) / n : null };
    })
    .filter((r) => r.grades.some((g) => g > 0))
    .sort((a, b) => b.grades.reduce((x, y) => x + y, 0) - a.grades.reduce((x, y) => x + y, 0));
}

export interface Leader { label: string; player: Player; value: string }

/** Top performer per category; ratios need a minimum volume to count. */
export function leaders(rows: PlayerRow[]): Leader[] {
  const pick = (label: string, score: (s: StatLine) => number | null, fmt: (s: StatLine) => string, min: (s: StatLine) => boolean = () => true) => {
    const best = rows.filter((r) => min(r.stats) && (score(r.stats) ?? 0) > 0)
      .sort((a, b) => (score(b.stats) ?? 0) - (score(a.stats) ?? 0))[0];
    return best ? { label, player: best.player, value: fmt(best.stats) } : null;
  };
  return [
    pick('Points', (s) => s.points, (s) => String(s.points)),
    pick('Kills', (s) => s.kills, (s) => `${s.kills} (${s.attempts} att.)`),
    pick('Attack eff.', (s) => s.attackEff, (s) => fmtEff(s.attackEff), (s) => s.attempts >= 5),
    pick('Aces', (s) => s.aces, (s) => String(s.aces)),
    pick('Pass avg', (s) => s.recAvg, (s) => `${s.recAvg!.toFixed(2)} (${s.receptions})`, (s) => s.receptions >= 5),
    pick('Digs', (s) => s.digs, (s) => String(s.digs)),
    pick('Blocks', (s) => s.blockPoints, (s) => String(s.blockPoints)),
    pick('Assists', (s) => s.assists, (s) => String(s.assists)),
  ].filter((x): x is Leader => !!x);
}

export interface MatchReport {
  title: string;
  subtitle: string;
  confirmed: VEvent[];
  team: StatLine;
  rows: PlayerRow[];
  sets: ReturnType<typeof scoreBySet>;
  setsWon: { us: number; them: number };
  flow: ReturnType<typeof scoreFlow>;
  sources: ReturnType<typeof pointSources>;
  zones: ZoneStat[];
  receivers: ReceiverRow[];
  leaders: Leader[];
}

/** A set counts as decided once one side has reached 15 (5th set) or 25 points with a 2-point lead. */
export function setsWon(sets: ReturnType<typeof scoreBySet>) {
  let us = 0, them = 0;
  for (const s of sets) {
    const target = s.set === 5 ? 15 : 25;
    if (Math.max(s.us, s.them) >= target && Math.abs(s.us - s.them) >= 2) {
      if (s.us > s.them) us++; else them++;
    }
  }
  return { us, them };
}

export function matchReport(match: Pick<Match, 'label' | 'opponent' | 'played_on' | 'team_name'>, players: Player[], events: VEvent[]): MatchReport {
  const confirmed = events.filter((e) => e.status === 'confirmed');
  const rows = playerStats(players, confirmed).filter((r) => r.count > 0);
  const sets = scoreBySet(confirmed);
  return {
    title: match.opponent ? `${match.team_name ?? 'Us'} vs ${match.opponent}` : match.label,
    subtitle: [match.played_on, match.opponent ? match.label : null].filter(Boolean).join(' · '),
    confirmed,
    team: statLine(confirmed.filter((e) => e.player_id != null)),
    rows,
    sets,
    setsWon: setsWon(sets),
    flow: scoreFlow(confirmed),
    sources: pointSources(confirmed),
    zones: attackZones(confirmed),
    receivers: receivers(players, confirmed),
    leaders: leaders(rows),
  };
}

export interface TrendPoint { label: string; value: number | null }

/** One value per match, in date order (season small multiples). */
export function seasonTrend(matches: Pick<Match, 'id' | 'label' | 'opponent' | 'played_on'>[], events: VEvent[], metric: (s: StatLine) => number | null): TrendPoint[] {
  return matches.map((m) => ({
    label: m.opponent ?? m.label,
    value: metric(statLine(events.filter((e) => e.match_id === m.id && e.player_id != null))),
  }));
}
