import type { Player } from './api';
import type { Lineups } from './rotation';

/**
 * The match flow from the official match sheet. Per set and team the sheet has the
 * starting six by column (position I..VI), substitutions with the score, and the
 * service rounds: in each column, the team's own score when it lost the serve, one
 * cell per service turn of the player in that column. With who served first, that
 * is enough to replay the set point by point: who served, which rotation each team
 * was in, and who won the point.
 */

export type Side = 'A' | 'B';
export type Cell = number | 'X' | null;
export interface SheetHalf {
  start: (number | null)[];
  subs: { col: number | null; in: number | null; own: number | null; opp: number | null }[];
  rounds: Cell[][];
  timeouts: { own: number | null; opp: number | null }[];
}
export interface SheetSet { set: number; firstServe: Side | null; A: SheetHalf; B: SheetHalf }
export interface MatchSheetFlow { ourTeam: Side; sets: { a: number; b: number }[]; flow: SheetSet[] }

export interface SheetPoint {
  set: number;
  /** Who served this point, and the column (0..5) each team had in position I. */
  server: Side;
  slot: Record<Side, number>;
  winner: Side;
  /** Score after the point. */
  score: Record<Side, number>;
}

const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

/**
 * Own score at the end of each service turn, in turn order. The team that received
 * first rotates before its first serve, so its first turn is column II (column I's
 * first cell is crossed out).
 */
export function turnEnds(half: SheetHalf, servedFirst: boolean): number[] {
  const cells: Cell[] = [];
  for (const row of half.rounds) for (let c = 0; c < 6; c++) cells.push(row[c] ?? null);
  const out: number[] = [];
  for (let k = servedFirst ? 0 : 1; k < cells.length; k++) {
    const c = cells[k];
    if (c === 'X') continue;
    if (c == null) break;
    out.push(c);
  }
  return out;
}

/**
 * Replays one set. [final] is the set score from the result box. Returns the points
 * and whether the replay ends exactly on that score (otherwise a cell was misread).
 */
export function replaySet(s: SheetSet, final: { a: number; b: number }): { points: SheetPoint[]; ok: boolean } {
  if (!s.firstServe) return { points: [], ok: false };
  const ends: Record<Side, number[]> = { A: turnEnds(s.A, s.firstServe === 'A'), B: turnEnds(s.B, s.firstServe === 'B') };
  const target: Record<Side, number> = { A: final.a, B: final.b };
  const score: Record<Side, number> = { A: 0, B: 0 };
  const slot: Record<Side, number> = { A: 0, B: 0 };
  const turn: Record<Side, number> = { A: 0, B: 0 };
  const points: SheetPoint[] = [];
  let server: Side = s.firstServe;
  let mismatch = false;
  const done = () => {
    const [hi, lo] = score.A >= score.B ? [score.A, score.B] : [score.B, score.A];
    return hi >= (s.set === 5 ? 15 : 25) && hi - lo >= 2;
  };
  while (!done() && points.length < 120) {
    const end = ends[server][turn[server]];
    // No cell for this turn: the set ended in it, so the server keeps scoring up to the final score.
    const keeps = end == null ? score[server] < target[server] : score[server] < end;
    const winner = keeps ? server : other(server);
    score[winner]++;
    points.push({ set: s.set, server, slot: { ...slot }, winner, score: { ...score } });
    if (winner !== server) {
      // The turn must end on the score written in its cell (lower = a misread cell).
      if (end != null && score[server] !== end) mismatch = true;
      turn[server]++;
      slot[winner] = (slot[winner] + 1) % 6;
      server = winner;
    }
  }
  // Every cell used exactly once: the last server's final turn may have its cell (the
  // circled score) or not; all other turns must have ended where the sheet says.
  const used = (t: Side) => turn[t] + (t === server && ends[t].length > turn[t] ? 1 : 0);
  const cellsOk = used('A') === ends.A.length && used('B') === ends.B.length;
  return { points, ok: score.A === target.A && score.B === target.B && cellsOk && !mismatch };
}

/** Jersey number in a column at a moment of the set (a substitute counts from the score it came in at). */
export function inColumn(half: SheetHalf, col: number, own: number, opp: number): number | null {
  let n = half.start[col] ?? null;
  for (const x of half.subs) {
    if (x.col !== col + 1 || x.in == null) continue;
    if (x.own == null || x.opp == null || x.own + x.opp <= own + opp) n = x.in;
  }
  return n;
}

export interface SheetRotation { label: string; received: number; sideouts: number; served: number; breaks: number }
export interface SheetServer { number: number; turns: number; points: number; won: number }

/**
 * Side-out and break points per rotation of ours, and serve turns per server, over
 * every set whose replay matches its score. Rotations are named by the setter's
 * column (S1 = setter in position I), as in the tag-based report.
 */
export function sheetStats(sheets: MatchSheetFlow[], players: Player[]) {
  const rot = new Map<string, SheetRotation>();
  const servers = new Map<number, SheetServer>();
  let sets = 0, skipped = 0;
  const setterNos = new Set(players.filter((p) => p.role === 'S' && p.number != null).map((p) => p.number!));
  for (const sh of sheets) {
    const us = sh.ourTeam, them = other(us);
    sh.flow.forEach((f) => {
      const final = sh.sets[f.set - 1];
      if (!final) { skipped++; return; }
      const { points, ok } = replaySet(f, final);
      if (!ok) { skipped++; return; }
      sets++;
      const half = f[us];
      const setterCol = half.start.findIndex((n) => n != null && setterNos.has(n));
      const label = (col: number) => (setterCol >= 0 ? `S${((setterCol - col + 6) % 6) + 1}` : `#${half.start[col] ?? '?'} in I`);
      for (const p of points) {
        const before = { own: p.score[us] - (p.winner === us ? 1 : 0), opp: p.score[them] - (p.winner === them ? 1 : 0) };
        const r = rot.get(label(p.slot[us])) ?? { label: label(p.slot[us]), received: 0, sideouts: 0, served: 0, breaks: 0 };
        if (p.server === us) {
          r.served++;
          if (p.winner === us) r.breaks++;
          const n = inColumn(half, p.slot[us], before.own, before.opp);
          if (n != null) {
            const sv = servers.get(n) ?? { number: n, turns: 0, points: 0, won: 0 };
            sv.points++;
            if (p.winner === us) sv.won++;
            servers.set(n, sv);
          }
        } else {
          r.received++;
          if (p.winner === us) r.sideouts++;
        }
        rot.set(r.label, r);
      }
      // Serve turns: a turn starts at every point we serve after one we did not.
      points.forEach((p, i) => {
        if (p.server !== us || (i > 0 && points[i - 1].server === us)) return;
        const before = { own: p.score[us] - (p.winner === us ? 1 : 0), opp: p.score[them] - (p.winner === them ? 1 : 0) };
        const n = inColumn(half, p.slot[us], before.own, before.opp);
        if (n != null) servers.get(n)!.turns++;
      });
    });
  }
  const rotations = [...rot.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return { rotations, servers: [...servers.values()].sort((a, b) => b.points - a.points), sets, skipped };
}

/**
 * Line-ups per set for the tagging screen from the sheet's starting six (columns I..VI
 * = positions 1..6), matched to our roster by jersey number. Sets whose six are not
 * all on the roster are left out.
 */
export function lineupsFromSheet(sh: MatchSheetFlow, players: Player[], liberoNo: number | null): Lineups {
  const byNo = new Map(players.filter((p) => p.active && p.number != null).map((p) => [p.number!, p.id]));
  const out: Lineups = {};
  for (const f of sh.flow) {
    const order = f[sh.ourTeam].start.slice(0, 6).map((n) => (n == null ? null : byNo.get(n) ?? null));
    if (order.length !== 6 || order.some((id) => id == null) || !f.firstServe) continue;
    out[String(f.set)] = { order, libero: liberoNo != null ? byNo.get(liberoNo) ?? null : null, weServeFirst: f.firstServe === sh.ourTeam };
  }
  return out;
}
