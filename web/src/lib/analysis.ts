import { ACTION_BY_CODE } from './actions';
import type { Player, VEvent } from './api';
import { rotationAfter, type Lineups } from './rotation';
import { playerStats, statLine } from './stats';
import { pointSources, receivers } from '../report/analytics';

const who = (p: Player) => `#${p.number ?? '–'} ${p.name.split(' ')[0]}`;

/**
 * Compact, grounded statistics payload for the AI coach summary — the same shape
 * whether it is built for the on-screen card or the PDF report.
 */
export function coachPayload(players: Player[], events: VEvent[], lineups: Map<number, Lineups | null | undefined>, season: boolean) {
  const confirmed = events.filter((e) => e.status === 'confirmed');
  const team = statLine(confirmed.filter((e) => e.player_id != null));
  const attackers = playerStats(players, confirmed).filter((r) => r.stats.attempts > 0).sort((a, b) => b.stats.attempts - a.stats.attempts);
  const recv = receivers(players, confirmed);
  const serves = serveRows(players, confirmed);
  const rotations = rotationStats(confirmed, lineups, players);
  const sources = pointSources(confirmed);
  const hasRot = rotations.some((r) => r.receiving + r.serving > 0);
  return {
    scope: season ? 'season' : 'match',
    team: {
      attackEff: team.attackEff, killPct: team.killPct, kills: team.kills, attackErrors: team.attackErrors, attempts: team.attempts,
      aces: team.aces, serveErrors: team.serveErrors, serves: team.serves, serveInPct: team.serveInPct,
      recAvg: team.recAvg, receptions: team.receptions, recPerfectPct: team.recPerfectPct, recErrors: team.recErrors,
      blockPoints: team.blockPoints, digs: team.digs, errors: team.errors, points: team.points,
    },
    players: attackers.slice(0, 8).map((r) => ({ name: who(r.player), role: r.player.role, kills: r.stats.kills, attackErrors: r.stats.attackErrors, attempts: r.stats.attempts, attackEff: r.stats.attackEff })),
    reception: recv.map((r) => ({ name: who(r.player), avg: r.avg, passes: r.grades.reduce((a, b) => a + b, 0) })),
    serving: serves.map((r) => ({ name: who(r.player), aces: r.aces, inPlay: r.inPlay, errors: r.errors })),
    rotations: hasRot ? rotations.map((r) => ({ setterPos: r.rotation, sideOutPct: sideOutPct(r), breakPct: breakPct(r), receiving: r.receiving, serving: r.serving })) : [],
    pointsWon: sources.won, pointsLost: sources.lost,
  };
}

const byTime = (a: VEvent, b: VEvent) => (a.set_no ?? 1) - (b.set_no ?? 1) || (a.t ?? 1e12) - (b.t ?? 1e12) || a.id - b.id;

export interface RotationRow {
  /** Rotation named by the setter's court position (1..6). */
  rotation: number;
  receiving: number; sideOuts: number;
  serving: number; breaks: number;
}

/**
 * Side-out % (points won when they serve) and break-point % (points won on our serve)
 * per rotation, replaying each set from its line-up. Needs the line-ups; sets without
 * one are skipped.
 */
export function rotationStats(events: VEvent[], lineupsByMatch: Map<number, Lineups | null | undefined>, players: Player[]): RotationRow[] {
  const rows: RotationRow[] = [1, 2, 3, 4, 5, 6].map((rotation) => ({ rotation, receiving: 0, sideOuts: 0, serving: 0, breaks: 0 }));
  const groups = new Map<string, VEvent[]>();
  for (const e of events) {
    if (e.status !== 'confirmed' || !ACTION_BY_CODE[e.action]?.score) continue;
    const k = `${e.match_id}:${e.set_no ?? 1}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  for (const [k, list] of groups) {
    const [matchId, set] = k.split(':').map(Number);
    const lineup = lineupsByMatch.get(matchId)?.[String(set)];
    if (!lineup) continue;
    const points: ('us' | 'them')[] = [];
    for (const e of list.sort(byTime)) {
      const state = rotationAfter(lineup, points, players, e.t ?? Infinity);
      const setter = state.positions.findIndex((id) => players.find((p) => p.id === id)?.role === 'S') + 1;
      const won = ACTION_BY_CODE[e.action].score === 'us';
      const row = rows[(setter || 1) - 1];
      if (state.weServe) { row.serving++; if (won) row.breaks++; } else { row.receiving++; if (won) row.sideOuts++; }
      points.push(won ? 'us' : 'them');
    }
  }
  return rows;
}

export interface ServeRow { player: Player; aces: number; inPlay: number; errors: number }

export function serveRows(players: Player[], events: VEvent[]): ServeRow[] {
  return players.map((player) => {
    const mine = events.filter((e) => e.player_id === player.id);
    const n = (a: string) => mine.filter((e) => e.action === a).length;
    return { player, aces: n('ace'), inPlay: n('serve'), errors: n('serve_error') };
  }).filter((r) => r.aces + r.inPlay + r.errors > 0).sort((a, b) => (b.aces + b.inPlay + b.errors) - (a.aces + a.inPlay + a.errors));
}

/** Rotation totals: share of points won when receiving / serving. */
export const sideOutPct = (r: Pick<RotationRow, 'receiving' | 'sideOuts'>) => (r.receiving ? r.sideOuts / r.receiving : null);
export const breakPct = (r: Pick<RotationRow, 'serving' | 'breaks'>) => (r.serving ? r.breaks / r.serving : null);

export interface Finding { text: string }

/**
 * A few plain-language takeaways from the saved touches (only where there is enough
 * data to say something): rotations, attack, reception, serve, where points went.
 */
export function keyFindings(
  team: { attackEff: number | null; attempts: number; recAvg: number | null; receptions: number; aces: number; serveErrors: number; serves: number },
  attackers: { name: string; kills: number; attempts: number; eff: number | null }[],
  receivers: { name: string; avg: number | null; n: number }[],
  rotations: RotationRow[],
  lost: { label: string; value: number }[],
): Finding[] {
  const out: Finding[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const eff = (v: number) => v.toFixed(3).replace(/^(-?)0\./, '$1.');
  const rec = rotations.reduce((a, r) => a + r.receiving, 0);
  if (rec >= 10) {
    const so = rotations.reduce((a, r) => a + r.sideOuts, 0) / rec;
    const ranked = rotations.filter((r) => r.receiving >= 4).map((r) => ({ r, v: r.sideOuts / r.receiving })).sort((a, b) => a.v - b.v);
    let t = `Side-out ${pct(so)} over ${rec} rallies on their serve`;
    if (ranked.length >= 2) t += `; best in S${ranked[ranked.length - 1].r.rotation} (${pct(ranked[ranked.length - 1].v)}), worst in S${ranked[0].r.rotation} (${pct(ranked[0].v)})`;
    out.push({ text: `${t}.` });
  }
  if (team.attempts >= 10) {
    const top = [...attackers].filter((a) => a.attempts >= 5).sort((a, b) => b.kills - a.kills)[0];
    out.push({ text: `Attack efficiency ${eff(team.attackEff ?? 0)} on ${team.attempts} attempts${top ? `; ${top.name} led with ${top.kills} kills (${eff(top.eff ?? 0)})` : ''}.` });
  }
  if (team.receptions >= 10 && team.recAvg != null) {
    const weak = receivers.filter((r) => r.n >= 5 && r.avg != null).sort((a, b) => a.avg! - b.avg!)[0];
    out.push({ text: `Pass average ${team.recAvg.toFixed(2)} on ${team.receptions} receptions${weak && weak.avg! < team.recAvg ? `; lowest: ${weak.name} (${weak.avg!.toFixed(2)} on ${weak.n})` : ''}.` });
  }
  if (team.serves >= 10) out.push({ text: `Serve: ${team.aces} aces and ${team.serveErrors} errors in ${team.serves} serves.` });
  const leak = [...lost].sort((a, b) => b.value - a.value)[0];
  const lostTotal = lost.reduce((a, b) => a + b.value, 0);
  if (leak && lostTotal >= 10) out.push({ text: `Most points given away: ${leak.label.toLowerCase()} (${leak.value} of ${lostTotal}).` });
  return out;
}

export interface ZoneRow { zone: number; n: number; good: number; value: number | null }

/** Our court zone (1..6) of a point on our half, as our team numbers it. */
function ourZone(x: number, y: number): number | null {
  if (x < 0 || x > 9 || y < 0 || y > 9) return null;
  const col = x < 3 ? 0 : x < 6 ? 1 : 2;
  return y >= 6 ? [4, 3, 2][col] : [5, 6, 1][col];
}

/** Attacks by the zone they were hit from (our half): kill % per zone. */
export function attackOrigins(events: VEvent[]): ZoneRow[] {
  const rows = [4, 3, 2, 5, 6, 1].map((zone) => ({ zone, n: 0, good: 0, value: null as number | null }));
  for (const e of events) {
    if (!['attack', 'kill', 'attack_error', 'attack_blocked'].includes(e.action) || e.fx == null || e.fy == null) continue;
    const z = ourZone(e.fx, e.fy);
    const r = rows.find((x) => x.zone === z);
    if (!r) continue;
    r.n++;
    if (e.action === 'kill') r.good++;
  }
  return rows.map((r) => ({ ...r, value: r.n ? r.good / r.n : null }));
}

/** Passes by the zone they were received in (our half): average grade per zone. */
export function receptionZones(events: VEvent[]): ZoneRow[] {
  const rows = [4, 3, 2, 5, 6, 1].map((zone) => ({ zone, n: 0, good: 0, value: null as number | null }));
  for (const e of events) {
    if (e.action !== 'receive' || e.value == null || e.fx == null || e.fy == null) continue;
    const r = rows.find((x) => x.zone === ourZone(e.fx!, e.fy!));
    if (!r) continue;
    r.n++;
    r.good += e.value;
  }
  return rows.map((r) => ({ ...r, value: r.n ? r.good / r.n : null }));
}
