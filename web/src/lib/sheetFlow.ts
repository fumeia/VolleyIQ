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

/** A written service-round cell: its score, row (0 = round 1) and column (0 = I). */
export interface TurnCell { value: number | null; row: number; col: number }

/**
 * The service-round cells of a team in turn order. The team that received first
 * rotates before its first serve, so its first turn is column II (column I's first
 * cell is crossed out). An unreadable cell between written ones stays in as null.
 */
export function turnCells(half: SheetHalf, servedFirst: boolean): TurnCell[] {
  const cells: TurnCell[] = [];
  half.rounds.forEach((row, r) => { for (let c = 0; c < 6; c++) cells.push({ value: (row[c] ?? null) as number | null, row: r, col: c }); });
  const out: TurnCell[] = [];
  for (let k = servedFirst ? 0 : 1; k < cells.length; k++) {
    const c = cells[k];
    if ((c.value as unknown) === 'X') continue;
    out.push(c);
  }
  // Empty cells after the last written one are turns that never came.
  while (out.length && out[out.length - 1].value == null) out.pop();
  return out;
}

/** Own score at the end of each service turn, in turn order (unreadable cells left out). */
export function turnEnds(half: SheetHalf, servedFirst: boolean): number[] {
  return turnCells(half, servedFirst).map((c) => c.value).filter((v): v is number => v != null);
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
/** A spot where the scanned sheet does not add up: what is written there, and what the replay needed. */
export interface SheetIssue { team: Side; row: number | null; col: number | null; text: string }

/**
 * Replays one set. [final] is the set score from the result box. Returns the points,
 * whether the replay matches the sheet exactly, and where it does not: a cell lower
 * than the score the team already had, an unreadable cell, cells left over, or a
 * different end score. The points are still a best guess when it does not match.
 */
export function replaySet(s: SheetSet, final: { a: number; b: number }): { points: SheetPoint[]; ok: boolean; issues: SheetIssue[] } {
  if (!s.firstServe) return { points: [], ok: false, issues: [{ team: 'A', row: null, col: null, text: 'Who served first is not known' }] };
  const cells: Record<Side, TurnCell[]> = { A: turnCells(s.A, s.firstServe === 'A'), B: turnCells(s.B, s.firstServe === 'B') };
  const target: Record<Side, number> = { A: final.a, B: final.b };
  const score: Record<Side, number> = { A: 0, B: 0 };
  const slot: Record<Side, number> = { A: 0, B: 0 };
  const turn: Record<Side, number> = { A: 0, B: 0 };
  const points: SheetPoint[] = [];
  const issues: SheetIssue[] = [];
  const where = (c: TurnCell) => `service round ${c.row + 1}, column ${ROMAN[c.col]}`;
  let server: Side = s.firstServe;
  // Played until the final score in the result box (or past it, when a cell was misread).
  const done = () => (score.A >= target.A && score.B >= target.B) || score.A > target.A || score.B > target.B;
  while (!done() && points.length < 120) {
    const cell = cells[server][turn[server]];
    // No cell for this turn: the set ended in it, so the server keeps scoring up to the final score.
    // An unreadable cell: assume the serve was lost at once.
    const end = cell ? cell.value : undefined;
    const keeps = end === undefined ? score[server] < target[server] : end != null && score[server] < end;
    const winner = keeps ? server : other(server);
    score[winner]++;
    points.push({ set: s.set, server, slot: { ...slot }, winner, score: { ...score } });
    if (winner !== server) {
      if (cell && cell.value == null) issues.push({ team: server, row: cell.row, col: cell.col, text: `Team ${server}, ${where(cell)}: unreadable (counted as losing the serve at once, at ${score[server]})` });
      // The turn must end on the score written in its cell (lower = a misread cell).
      else if (cell && end != null && score[server] !== end) {
        issues.push({ team: server, row: cell.row, col: cell.col, text: `Team ${server}, ${where(cell)}: ${end} is written, but the team already had ${score[server]} there` });
      }
      turn[server]++;
      slot[winner] = (slot[winner] + 1) % 6;
      server = winner;
    }
  }
  // Every cell used exactly once: the last server's final turn may have its cell (the
  // circled score) or not; all other turns must have ended where the sheet says.
  for (const t of ['A', 'B'] as Side[]) {
    const used = turn[t] + (t === server && cells[t].length > turn[t] ? 1 : 0);
    if (used < cells[t].length) {
      const c = cells[t][used];
      issues.push({ team: t, row: c.row, col: c.col, text: `Team ${t}: ${cells[t].length - used} service-round cell${cells[t].length - used === 1 ? '' : 's'} left over after the set ended (from ${where(c)})` });
    }
  }
  if (score.A !== target.A || score.B !== target.B) {
    issues.push({ team: 'A', row: null, col: null, text: `The service rounds give ${score.A}:${score.B}, the result box ${target.A}:${target.B}` });
  }
  return { points, ok: issues.length === 0, issues };
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
