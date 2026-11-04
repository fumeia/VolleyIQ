import { type ActionCode } from './actions';
import { sideScore } from './practice';
import type { Player, VEvent } from './api';
import { zoneOf } from './court';
import { buildRallies, realAssists } from './sequence';

export interface StatLine {
  /** attackErrors includes the blocked attacks; blocked is that part on its own. */
  kills: number; attackErrors: number; blocked: number; attempts: number; killPct: number | null; attackEff: number | null;
  aces: number; serveErrors: number; serves: number; acePct: number | null; serveInPct: number | null;
  receptions: number; recAvg: number | null; recPerfectPct: number | null; recErrors: number;
  digs: number; digErrors: number; freeballs: number;
  blockPoints: number; blockTouches: number; blockErrors: number;
  /** Blocks without a touch (jumped, the ball went past). */
  blockMisses: number;
  /** assists = real assists (a set whose next touch is our kill, from the rallies); bumpSets = sets by a
   *  non-setter (the 'Bump set' action); assistErrors = bump-set errors. */
  sets: number; assists: number; bumpSets: number; assistErrors: number; setErrors: number;
  points: number; errors: number; plusMinus: number;
}

type Ev = Pick<VEvent, 'action' | 'value'>;

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function statLine(events: Ev[]): StatLine {
  const c = {} as Record<ActionCode, number>;
  let recSum = 0, recN = 0, recPerfect = 0, recErr = 0;
  for (const e of events) {
    c[e.action] = (c[e.action] ?? 0) + 1;
    if (e.action === 'receive' && e.value != null) {
      recN++; recSum += e.value;
      if (e.value === 3) recPerfect++;
      if (e.value === 0) recErr++;
    }
  }
  const n = (k: ActionCode) => c[k] ?? 0;
  const kills = n('kill'), blocked = n('attack_blocked'), attackErrors = n('attack_error') + blocked;
  const attempts = kills + attackErrors + n('attack');
  const aces = n('ace'), serveErrors = n('serve_error');
  const serves = aces + serveErrors + n('serve');
  const blockPoints = n('block_point');
  const bumpSets = n('assist'), assistErrors = n('assist_error'), setErrors = n('set_error');
  const points = kills + aces + blockPoints;
  const errors = attackErrors + serveErrors + n('dig_error') + n('block_error') + assistErrors + setErrors + recErr;
  return {
    kills, attackErrors, blocked, attempts,
    killPct: ratio(kills, attempts), attackEff: ratio(kills - attackErrors, attempts),
    aces, serveErrors, serves, acePct: ratio(aces, serves), serveInPct: ratio(serves - serveErrors, serves),
    receptions: recN, recAvg: ratio(recSum, recN), recPerfectPct: ratio(recPerfect, recN), recErrors: recErr,
    digs: n('dig'), digErrors: n('dig_error'), freeballs: n('freeball'),
    blockPoints, blockTouches: n('block_touch'), blockErrors: n('block_error'), blockMisses: n('block_miss'),
    sets: n('set') + bumpSets + assistErrors + setErrors, assists: 0, bumpSets, assistErrors, setErrors,
    points, errors, plusMinus: points - errors,
  };
}

export function playerStats(players: Player[], events: VEvent[]) {
  const byPlayer = new Map<number, VEvent[]>();
  for (const e of events) {
    if (e.player_id == null) continue;
    if (!byPlayer.has(e.player_id)) byPlayer.set(e.player_id, []);
    byPlayer.get(e.player_id)!.push(e);
  }
  // Assists need the order of the touches (set -> kill), so they come from the whole rally.
  const assists = realAssists(buildRallies(events));
  return players
    .filter((p) => byPlayer.has(p.id) || p.active)
    .map((p) => ({ player: p, stats: { ...statLine(byPlayer.get(p.id) ?? []), assists: assists.get(p.id) ?? 0 }, count: byPlayer.get(p.id)?.length ?? 0 }))
    .sort((a, b) => b.stats.points - a.stats.points || b.count - a.count);
}

/** Team totals, with the assists counted from the rallies. */
export function teamLine(events: VEvent[]): StatLine {
  const line = statLine(events.filter((e) => e.player_id != null));
  let assists = 0;
  for (const n of realAssists(buildRallies(events)).values()) assists += n;
  return { ...line, assists };
}

export function roleStats(players: Player[], events: VEvent[]) {
  const roleOf = new Map(players.map((p) => [p.id, p.role]));
  const assists = realAssists(buildRallies(events));
  const byRole = new Map<string, VEvent[]>();
  const assistsByRole = new Map<string, number>();
  for (const [id, n] of assists) {
    const r = roleOf.get(id);
    if (r) assistsByRole.set(r, (assistsByRole.get(r) ?? 0) + n);
  }
  for (const e of events) {
    const role = e.player_id != null ? roleOf.get(e.player_id) : undefined;
    if (!role) continue;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push(e);
  }
  return [...byRole.entries()].map(([role, evs]) => ({ role, stats: { ...statLine(evs), assists: assistsByRole.get(role) ?? 0 }, count: evs.length }));
}

export function zoneCounts(events: VEvent[], actions: ActionCode[]) {
  const counts = [0, 0, 0, 0, 0, 0, 0]; // index 1..6
  for (const e of events) {
    if (!actions.includes(e.action)) continue;
    const z = e.zone ?? (e.x != null && e.y != null ? zoneOf({ x: e.x, y: e.y }) : null);
    if (z) counts[z]++;
  }
  return counts;
}

export interface SetScore { set: number; us: number; them: number }

/** Running score per set, derived from point-ending events. */
/**
 * Points per set. A practice match counts as its first side ("us") against the second: a point of a
 * second-side player goes to "them", and the second side's view of an analysed match is left out.
 */
export function scoreBySet(events: Pick<VEvent, 'action' | 'set_no' | 'side' | 'view' | 'value'>[]): SetScore[] {
  const sets = new Map<number, SetScore>();
  for (const e of events) {
    if (e.view === 'b') continue;
    const s = e.set_no ?? 1;
    if (!sets.has(s)) sets.set(s, { set: s, us: 0, them: 0 });
    const effect = sideScore(e);
    if (effect === 'us') sets.get(s)!.us++;
    else if (effect === 'them') sets.get(s)!.them++;
  }
  return [...sets.values()].sort((a, b) => a.set - b.set);
}

export const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
export const dec = (v: number | null, d = 2) => (v == null ? '–' : v.toFixed(d));
