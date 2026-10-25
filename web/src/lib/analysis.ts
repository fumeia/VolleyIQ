import { ACTION_BY_CODE } from './actions';
import type { Player, VEvent } from './api';
import { rotationAfter, type Lineups } from './rotation';

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
