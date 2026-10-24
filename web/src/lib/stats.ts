import { ACTION_BY_CODE, type ActionCode } from './actions';
import type { Player, VEvent } from './api';

export interface StatLine {
  kills: number; attackErrors: number; attempts: number; killPct: number | null; attackEff: number | null;
  aces: number; serveErrors: number; serves: number; acePct: number | null; serveInPct: number | null;
  receptions: number; recAvg: number | null; recPerfectPct: number | null; recErrors: number;
  digs: number; digErrors: number;
  blockPoints: number; blockTouches: number; blockErrors: number;
  sets: number; assists: number; assistErrors: number;
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
  const kills = n('kill'), attackErrors = n('attack_error');
  const attempts = kills + attackErrors + n('attack');
  const aces = n('ace'), serveErrors = n('serve_error');
  const serves = aces + serveErrors + n('serve');
  const blockPoints = n('block_point');
  const assists = n('assist'), assistErrors = n('assist_error');
  const points = kills + aces + blockPoints;
  const errors = attackErrors + serveErrors + n('dig_error') + n('block_error') + assistErrors + recErr;
  return {
    kills, attackErrors, attempts,
    killPct: ratio(kills, attempts), attackEff: ratio(kills - attackErrors, attempts),
    aces, serveErrors, serves, acePct: ratio(aces, serves), serveInPct: ratio(serves - serveErrors, serves),
    receptions: recN, recAvg: ratio(recSum, recN), recPerfectPct: ratio(recPerfect, recN), recErrors: recErr,
    digs: n('dig'), digErrors: n('dig_error'),
    blockPoints, blockTouches: n('block_touch'), blockErrors: n('block_error'),
    sets: n('set') + assists + assistErrors, assists, assistErrors,
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
  return players
    .filter((p) => byPlayer.has(p.id) || p.active)
    .map((p) => ({ player: p, stats: statLine(byPlayer.get(p.id) ?? []), count: byPlayer.get(p.id)?.length ?? 0 }))
    .sort((a, b) => b.stats.points - a.stats.points || b.count - a.count);
}

export function roleStats(players: Player[], events: VEvent[]) {
  const roleOf = new Map(players.map((p) => [p.id, p.role]));
  const byRole = new Map<string, VEvent[]>();
  for (const e of events) {
    const role = e.player_id != null ? roleOf.get(e.player_id) : undefined;
    if (!role) continue;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push(e);
  }
  return [...byRole.entries()].map(([role, evs]) => ({ role, stats: statLine(evs), count: evs.length }));
}

export function zoneCounts(events: VEvent[], actions: ActionCode[]) {
  const counts = [0, 0, 0, 0, 0, 0, 0]; // index 1..6
  for (const e of events) if (e.zone && actions.includes(e.action)) counts[e.zone]++;
  return counts;
}

export interface SetScore { set: number; us: number; them: number }

/** Running score per set, derived from point-ending events. */
export function scoreBySet(events: Pick<VEvent, 'action' | 'set_no'>[]): SetScore[] {
  const sets = new Map<number, SetScore>();
  for (const e of events) {
    const s = e.set_no ?? 1;
    if (!sets.has(s)) sets.set(s, { set: s, us: 0, them: 0 });
    const effect = ACTION_BY_CODE[e.action]?.score;
    if (effect === 'us') sets.get(s)!.us++;
    else if (effect === 'them') sets.get(s)!.them++;
  }
  return [...sets.values()].sort((a, b) => a.set - b.set);
}

export const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
export const dec = (v: number | null, d = 2) => (v == null ? '–' : v.toFixed(d));
