import { tagOrder } from './actions';
import { scoreOf } from './actions';
import type { Match, Player, VEvent } from './api';
import { rotationAfter, type Lineup } from './rotation';
import { attackContexts, buildRallies, phaseScoring, SETS, type Ratio } from './sequence';
import { statLine, type StatLine } from './stats';
import type { Side } from './practice';

/**
 * Analysis of a practice match (both sides our own players, mixed anew each set). No "us" and
 * "them": each set's two sides, what each player did in their role, and how the combinations
 * worked: setters with hitters, setters with good and poor passes, passers, and what changed for
 * a player with another setter.
 * [events]: the match's expanded tags (each side's view, see expandPractice), confirmed only.
 */

export type SlotRole = 'S' | 'OH' | 'MB' | 'OPP' | 'L';
export const SLOT_NAMES: Record<SlotRole, string> = { S: 'Setter', OH: 'Outside', MB: 'Middle', OPP: 'Opposite', L: 'Libero' };

/** Attacks: kills, errors (blocked included), attempts. */
export interface Tally { kills: number; errors: number; n: number }
const tally = (): Tally => ({ kills: 0, errors: 0, n: 0 });
export const effOf = (t: Tally) => (t.n ? (t.kills - t.errors) / t.n : null);
function count(t: Tally, a: VEvent) {
  t.n++;
  if (a.action === 'kill') t.kills++;
  else if (a.action === 'attack_error' || a.action === 'attack_blocked') t.errors++;
}

export interface SideSet {
  set: number; side: Side;
  /** "Ann's side", or the side's own name when the coach gave one. */
  label: string;
  players: number[];
  lineup: Lineup | null;
  setter: number | null;
  /** Each player's role (team page). */
  roleOf: Map<number, SlotRole>;
  tagged: boolean;
  pointsFor: number; pointsAgainst: number;
  sideout: Ratio; brk: Ratio;
  line: StatLine;
  perPlayer: Map<number, StatLine>;
  /** The side's attacks after its setter's sets. */
  setterAttacks: Tally;
  rotations: { pos: number; serving: number; breaks: number; receiving: number; sideOuts: number }[];
  events: VEvent[];
}

const firstName = (p?: Player) => (p ? p.name.split(' ')[0] : '?');
export const who = (p?: Player) => (p ? `#${p.number ?? '–'} ${firstName(p)}` : '?');

/** The side's setter in a set: whoever set most (2+ sets), else the line-up's player with the setter role. */
function setterOf(evs: VEvent[], ids: number[], lineup: Lineup | null, players: Player[]): number | null {
  const n = new Map<number, number>();
  for (const e of evs) if (e.player_id != null && (e.action === 'set' || e.action === 'set_error')) n.set(e.player_id, (n.get(e.player_id) ?? 0) + 1);
  const top = [...n].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) return top[0];
  const pool = lineup ? lineup.order.filter((x): x is number => x != null) : ids;
  return pool.find((id) => players.find((p) => p.id === id)?.role === 'S') ?? top?.[0] ?? null;
}

/** Each player's role from the team page. */
function rolesFrom(ids: number[], players: Player[]): Map<number, SlotRole> {
  const out = new Map<number, SlotRole>();
  for (const id of ids) {
    const r = players.find((p) => p.id === id)?.role;
    if (r === 'S' || r === 'OH' || r === 'MB' || r === 'OPP' || r === 'L') out.set(id, r);
  }
  return out;
}

const byTime = (a: VEvent, b: VEvent) => (a.t ?? Infinity) - (b.t ?? Infinity) || tagOrder(a.id) - tagOrder(b.id);

/**
 * The line-ups of a set, each given to the side whose players it holds (a swap of the sides
 * after the line-ups were entered moves them along); by its key when it matches neither.
 */
function lineupsForSet(match: Match, set: number): Record<Side, Lineup | null> {
  const p = match.practice!;
  const la = match.lineups?.[String(set)] ?? null, lb = p.lineupsB?.[String(set)] ?? null;
  const s = p.sets[String(set)];
  if (!s) return { a: la, b: lb };
  const fit = (l: Lineup | null, ids: number[]) => (l ? l.order.filter((x) => x != null && ids.includes(x)).length : 0);
  const swapped = fit(la, s.b) + fit(lb, s.a) > fit(la, s.a) + fit(lb, s.b);
  return swapped ? { a: lb, b: la } : { a: la, b: lb };
}

export function sideSets(match: Match, players: Player[], events: VEvent[]): SideSet[] {
  const p = match.practice;
  if (!p) return [];
  const own = events.filter((e) => e.match_id === match.id && e.status === 'confirmed');
  const sets = [...new Set([...Object.keys(p.sets).map(Number), ...own.map((e) => e.set_no ?? 1)])].sort((a, b) => a - b);
  const custom = (k: Side) => (['Near', 'Far', ''].includes(p.names[k]?.trim() ?? '') ? null : p.names[k]);
  const out: SideSet[] = [];
  for (const set of sets) {
    const lineups = lineupsForSet(match, set);
    for (const side of ['a', 'b'] as Side[]) {
      const evs = own.filter((e) => (e.set_no ?? 1) === set && (e.view ?? 'a') === side);
      const ids = p.sets[String(set)]?.[side] ?? [];
      if (!evs.length && !ids.length) continue;
      const lineup = lineups[side];
      const setter = setterOf(evs, ids, lineup, players);
      let pf = 0, pa = 0;
      for (const e of evs) { const s = scoreOf(e); if (s === 'us') pf++; else if (s === 'them') pa++; }
      const rallies = buildRallies(evs);
      const ph = phaseScoring(rallies);
      const perPlayer = new Map<number, StatLine>();
      for (const id of new Set([...ids, ...evs.map((e) => e.player_id).filter((x): x is number => x != null)])) {
        perPlayer.set(id, statLine(evs.filter((e) => e.player_id === id)));
      }
      const setterAttacks = tally();
      for (const c of attackContexts(rallies)) if (setter != null && c.set?.player_id === setter && c.attack.player_id !== setter) count(setterAttacks, c.attack);
      const rotations = [1, 2, 3, 4, 5, 6].map((pos) => ({ pos, serving: 0, breaks: 0, receiving: 0, sideOuts: 0 }));
      if (lineup && setter != null && lineup.order.includes(setter)) {
        const points: ('us' | 'them')[] = [];
        for (const e of evs.filter((x) => scoreOf(x)).sort(byTime)) {
          const st = rotationAfter(lineup, points, players, e.t ?? Infinity);
          const at = st.positions.indexOf(setter);
          const won = scoreOf(e) === 'us';
          const row = rotations[at >= 0 ? at : 0];
          if (st.weServe) { row.serving++; if (won) row.breaks++; } else { row.receiving++; if (won) row.sideOuts++; }
          points.push(won ? 'us' : 'them');
        }
      }
      const name = custom(side);
      out.push({
        set, side, players: ids, lineup, setter,
        label: name ?? (setter != null ? `${firstName(players.find((x) => x.id === setter))}'s side` : side === 'a' ? 'Side 1' : 'Side 2'),
        roleOf: rolesFrom([...new Set([...ids, ...(lineup ? lineup.order.filter((x): x is number => x != null) : []), ...(lineup?.libero != null ? [lineup.libero] : []), ...evs.map((e) => e.player_id).filter((x): x is number => x != null)])], players),
        tagged: evs.some((e) => e.player_id != null || scoreOf(e)),
        pointsFor: pf, pointsAgainst: pa, sideout: ph.sideout, brk: ph.break,
        line: statLine(evs.filter((e) => e.player_id != null)), perPlayer, setterAttacks, rotations, events: evs,
      });
    }
  }
  // Two sides with the same name in a set: tell them apart.
  for (const set of sets) {
    const two = out.filter((s) => s.set === set);
    if (two.length === 2 && two[0].label === two[1].label) { two[0].label += ' (1)'; two[1].label += ' (2)'; }
  }
  return out;
}

/* ------------------------------------------------------------ setters */

export interface SetterRow {
  setter: number;
  sets: number[];
  sideout: Ratio; brk: Ratio;
  /** Attacks after this setter's sets: all, after a good first contact (grade 2-3), after a poor one (0-1). */
  all: Tally; good: Tally; poor: Tally;
  /** Share of this setter's sets that went to each hitter. */
  spread: { hitter: number; n: number }[];
}

/** Each setter over the sets they set: their side's side-out and break, and what the hitters made of their sets. */
export function setterRows(sides: SideSet[]): SetterRow[] {
  const m = new Map<number, SetterRow>();
  for (const s of sides) {
    if (s.setter == null || !s.tagged) continue;
    const r = m.get(s.setter) ?? { setter: s.setter, sets: [], sideout: { won: 0, n: 0 }, brk: { won: 0, n: 0 }, all: tally(), good: tally(), poor: tally(), spread: [] };
    r.sets.push(s.set);
    r.sideout = { won: r.sideout.won + s.sideout.won, n: r.sideout.n + s.sideout.n };
    r.brk = { won: r.brk.won + s.brk.won, n: r.brk.n + s.brk.n };
    for (const c of attackContexts(buildRallies(s.events))) {
      if (c.set?.player_id !== s.setter || c.attack.player_id == null || c.attack.player_id === s.setter) continue;
      count(r.all, c.attack);
      if (c.quality != null) count(c.quality >= 2 ? r.good : r.poor, c.attack);
      const sp = r.spread.find((x) => x.hitter === c.attack.player_id);
      if (sp) sp.n++; else r.spread.push({ hitter: c.attack.player_id, n: 1 });
    }
    m.set(s.setter, r);
  }
  for (const r of m.values()) r.spread.sort((a, b) => b.n - a.n);
  return [...m.values()].sort((a, b) => b.sets.length - a.sets.length);
}

export interface Pairing extends Tally { setter: number; hitter: number }

/** Each setter with each hitter: the attacks right after that setter's set, across the match. */
export function setterHitter(sides: SideSet[]): Pairing[] {
  const m = new Map<string, Pairing>();
  for (const s of sides) {
    for (const c of attackContexts(buildRallies(s.events))) {
      const st = c.set?.player_id, h = c.attack.player_id;
      if (st == null || h == null || st === h || !SETS.includes(c.set!.action)) continue;
      const k = `${st}:${h}`;
      const row = m.get(k) ?? { setter: st, hitter: h, ...tally() };
      count(row, c.attack);
      m.set(k, row);
    }
  }
  return [...m.values()];
}

export interface PasserRow { player: number; n: number; avg: number | null; perfect: number; errors: number; after: Tally; roles: SlotRole[] }

/** Passers (libero included): pass grades, and what the side's attack made of their passes. */
export function passers(sides: SideSet[]): PasserRow[] {
  const m = new Map<number, PasserRow>();
  for (const s of sides) {
    for (const e of s.events) {
      if (e.action !== 'receive' || e.player_id == null || e.value == null) continue;
      const r = m.get(e.player_id) ?? { player: e.player_id, n: 0, avg: 0, perfect: 0, errors: 0, after: tally(), roles: [] };
      r.avg = (r.avg! * r.n + e.value) / (r.n + 1); r.n++;
      if (e.value === 3) r.perfect++;
      if (e.value === 0) r.errors++;
      const role = s.roleOf.get(e.player_id);
      if (role && !r.roles.includes(role)) r.roles.push(role);
      m.set(e.player_id, r);
    }
    for (const c of attackContexts(buildRallies(s.events))) {
      if (c.origin?.action !== 'receive' || c.origin.player_id == null) continue;
      const r = m.get(c.origin.player_id);
      if (r) count(r.after, c.attack);
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

/* ------------------------------------------------- one player's sets */

/** A player's main numbers for their role: attack for hitters, passes for passers, the hitters after their sets for setters. */
export interface KeyNumber { label: string; value: number | null; text: string; n: number; kind: 'attack' | 'pass' | 'setting' }

export function keyNumbers(role: SlotRole | null, l: StatLine, side?: SideSet, id?: number): KeyNumber[] {
  const out: KeyNumber[] = [];
  const eff = (k: number, e: number, n: number) => (n ? (k - e) / n : null);
  const fmt = (v: number | null) => (v == null ? '–' : `${v > 0.0005 ? '+' : ''}${v.toFixed(2).replace(/^(-?)0\./, '$1.')}`);
  if (role === 'S' && side && side.setter === id) {
    const t = side.setterAttacks;
    out.push({ kind: 'setting', label: 'Hitters after their sets', value: effOf(t), text: `${fmt(effOf(t))} (${t.kills}-${t.errors}/${t.n})`, n: t.n });
  }
  if (role !== 'L' && role !== 'S' && l.attempts) out.push({ kind: 'attack', label: 'Attack', value: eff(l.kills, l.attackErrors, l.attempts), text: `${fmt(eff(l.kills, l.attackErrors, l.attempts))} (${l.kills}-${l.attackErrors}/${l.attempts})`, n: l.attempts });
  if (l.receptions) out.push({ kind: 'pass', label: 'Pass', value: l.recAvg, text: `${l.recAvg!.toFixed(1)} (${l.receptions})`, n: l.receptions });
  return out;
}

export interface PlayerSet { set: number; side: SideSet; role: SlotRole | null; setter: number | null; line: StatLine; won: boolean | null; keys: KeyNumber[] }

/** One player's sets: on which side, with which setter, and how it went. */
export function playerTimeline(id: number, sides: SideSet[]): PlayerSet[] {
  return sides
    .filter((s) => s.players.includes(id) || s.events.some((e) => e.player_id === id))
    .map((s) => {
      const role = s.roleOf.get(id) ?? null;
      const line = s.perPlayer.get(id) ?? statLine([]);
      return {
        set: s.set, side: s, role, setter: s.setter, line,
        won: s.pointsFor === s.pointsAgainst ? null : s.pointsFor > s.pointsAgainst,
        keys: keyNumbers(role, line, s, id),
      };
    });
}

export interface Change { player: number; from: PlayerSet; to: PlayerSet; what: string[]; key: KeyNumber['kind']; before: KeyNumber; after: KeyNumber; delta: number }

/**
 * From one set to the next: who got a different setter, and the number that fits what they
 * did (attack, pass or setting) before and after. Only when both sets have enough of it (3+).
 */
export function changes(players: Player[], sides: SideSet[]): Change[] {
  const out: Change[] = [];
  const ids = new Set(sides.flatMap((s) => [...s.players, ...s.perPlayer.keys()]));
  const name = (id: number | null) => who(players.find((p) => p.id === id));
  for (const id of ids) {
    const tl = playerTimeline(id, sides);
    for (let i = 1; i < tl.length; i++) {
      const from = tl[i - 1], to = tl[i];
      const what: string[] = [];
      if (from.setter !== to.setter && to.setter !== id && from.setter !== id && from.setter != null && to.setter != null) what.push(`setter ${name(from.setter)} → ${name(to.setter)}`);
      if (!what.length) continue;
      for (const kind of ['setting', 'attack', 'pass'] as const) {
        const b = from.keys.find((k) => k.kind === kind), a = to.keys.find((k) => k.kind === kind);
        if (!b || !a || b.n < 3 || a.n < 3 || b.value == null || a.value == null) continue;
        out.push({ player: id, from, to, what, key: kind, before: b, after: a, delta: a.value - b.value });
        break;
      }
    }
  }
  return out.sort((a, b) => a.from.set - b.from.set || Math.abs(b.delta) - Math.abs(a.delta));
}

/* ------------------------------------------------------------ findings */

export interface Finding { text: string; tone: 'good' | 'bad' | 'info' }

const effText = (t: Tally) => `${t.kills} kills, ${t.errors} errors in ${t.n} attacks`;

/** The few things the numbers say most clearly; only with enough attempts behind them. */
export function findings(players: Player[], sides: SideSet[]): Finding[] {
  const name = (id: number | null) => who(players.find((p) => p.id === id));
  const out: Finding[] = [];
  const pairs = setterHitter(sides).filter((r) => r.n >= 4).sort((a, b) => effOf(b)! - effOf(a)! || b.n - a.n);
  if (pairs.length) {
    const b = pairs[0];
    out.push({ tone: 'good', text: `Best setter and hitter: ${name(b.setter)} setting ${name(b.hitter)}: ${effText(b)}.` });
    const other = pairs.filter((r) => r.hitter === b.hitter && r.setter !== b.setter).sort((x, y) => effOf(x)! - effOf(y)!)[0];
    if (other) out.push({ tone: 'info', text: `${name(b.hitter)} with ${name(other.setter)} setting: ${effText(other)}.` });
    const w = pairs[pairs.length - 1];
    if (pairs.length > 1 && effOf(w)! < 0.1 && w !== other) out.push({ tone: 'bad', text: `Not working yet: ${name(w.setter)} setting ${name(w.hitter)}: ${effText(w)}.` });
  }
  const st = setterRows(sides).filter((r) => r.sideout.n >= 8);
  if (st.length > 1) {
    const by = [...st].sort((a, b) => b.sideout.won / b.sideout.n - a.sideout.won / a.sideout.n);
    const p = (r: Ratio) => `${Math.round((r.won / r.n) * 100)}% (${r.won}/${r.n})`;
    out.push({ tone: 'info', text: `Side-out with ${name(by[0].setter)} setting: ${p(by[0].sideout)}; with ${name(by[by.length - 1].setter)}: ${p(by[by.length - 1].sideout)}.` });
  }
  const poor = setterRows(sides).filter((r) => r.poor.n >= 4).sort((a, b) => effOf(b.poor)! - effOf(a.poor)!);
  if (poor.length > 1) out.push({ tone: 'good', text: `Most out of poor passes: ${name(poor[0].setter)} (hitters ${effText(poor[0].poor)} after a pass graded 0 or 1).` });
  const ps = passers(sides).filter((r) => r.n >= 8).sort((a, b) => b.avg! - a.avg!);
  if (ps.length > 1) out.push({ tone: 'good', text: `Best passer: ${name(ps[0].player)}, ${ps[0].avg!.toFixed(2)} on ${ps[0].n} passes${ps[0].perfect ? `, ${ps[0].perfect} perfect` : ''}.` });
  return out;
}

/* ------------------------------------------------------------ errors */

export interface PointSources { kills: number; aces: number; blocks: number; fromErrors: number; other: number }

/**
 * Where a side's points in a set came from: its own kills, aces and block points, or the other
 * side's errors (serve, attack, set, pass, dig, block). "other": points tagged without saying how.
 */
export function pointSources(s: SideSet): PointSources {
  let kills = 0, aces = 0, blocks = 0, fromErrors = 0;
  for (const e of s.events) {
    if (scoreOf(e) !== 'us') continue;
    if (e.action === 'kill') kills++;
    else if (e.action === 'ace') aces++;
    else if (e.action === 'block_point') blocks++;
    else if (e.action === 'opp_error') fromErrors++;
  }
  return { kills, aces, blocks, fromErrors, other: Math.max(0, s.pointsFor - kills - aces - blocks - fromErrors) };
}
