import { scoreOf } from './actions';
import type { Match, Player, VEvent } from './api';
import { orderAt, rotationAfter, type Lineup } from './rotation';
import { buildRallies, phaseScoring, SETS, ATTACKS, type Rally } from './sequence';
import { statLine, type StatLine } from './stats';
import type { Side } from './practice';

/**
 * Analysis of a practice match (both sides our own players, mixed anew each set): no "us" and
 * "them", but each set's two sides, who set for them, and what changed from set to set.
 * [events]: the match's expanded tags (each side's view, see expandPractice), confirmed only.
 */

export type SlotRole = 'S' | 'OH' | 'MB' | 'OPP' | 'L';
export const SLOT_NAMES: Record<SlotRole, string> = { S: 'Setter', OH: 'Outside', MB: 'Middle', OPP: 'Opposite', L: 'Libero' };

export interface SideSet {
  set: number; side: Side;
  /** "Lena setting", or the side's own name when the coach gave one. */
  label: string;
  players: number[];
  lineup: Lineup | null;
  setter: number | null;
  /** What each player did in this set: their position from the line-up (relative to the setter). */
  roleOf: Map<number, SlotRole>;
  pointsFor: number; pointsAgainst: number;
  sideoutPct: number | null; breakPct: number | null;
  line: StatLine;
  perPlayer: Map<number, StatLine>;
  /** Per rotation (setter's court position 1..6): rallies served / received and won. */
  rotations: { pos: number; serving: number; breaks: number; receiving: number; sideOuts: number }[];
  events: VEvent[];
}

const firstName = (p?: Player) => (p ? p.name.split(' ')[0] : '?');
export const who = (p?: Player) => (p ? `#${p.number ?? '–'} ${firstName(p)}` : '?');

/** The side's setter in a set: whoever set most, else the line-up's player with the setter role. */
function setterOf(evs: VEvent[], ids: number[], lineup: Lineup | null, players: Player[]): number | null {
  const n = new Map<number, number>();
  for (const e of evs) if (e.player_id != null && SETS.includes(e.action) && e.action !== 'assist' && e.action !== 'assist_error') n.set(e.player_id, (n.get(e.player_id) ?? 0) + 1);
  const top = [...n].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) return top[0];
  const pool = lineup ? lineup.order.filter((x): x is number => x != null) : ids;
  return pool.find((id) => players.find((p) => p.id === id)?.role === 'S') ?? top?.[0] ?? null;
}

/** Positions in a 5-1 from the setter's place in the order: next outside, then middle, opposite, outside, middle. */
function rolesFrom(lineup: Lineup | null, setter: number | null, ids: number[], players: Player[]): Map<number, SlotRole> {
  const out = new Map<number, SlotRole>();
  const order = lineup ? orderAt(lineup, 0) : [];
  const i = setter == null ? -1 : order.indexOf(setter);
  if (lineup && i >= 0) {
    const slots: SlotRole[] = ['S', 'OH', 'MB', 'OPP', 'OH', 'MB'];
    order.forEach((id, k) => { if (id != null) out.set(id, slots[(k - i + 6) % 6]); });
    if (lineup.libero != null) out.set(lineup.libero, 'L');
  }
  // No line-up: the roster role.
  for (const id of ids) {
    if (out.has(id)) continue;
    const r = id === setter ? 'S' : players.find((p) => p.id === id)?.role;
    if (r === 'S' || r === 'OH' || r === 'MB' || r === 'OPP' || r === 'L') out.set(id, r);
  }
  return out;
}

const byTime = (a: VEvent, b: VEvent) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.id - b.id;

export function sideSets(match: Match, players: Player[], events: VEvent[]): SideSet[] {
  const p = match.practice;
  if (!p) return [];
  const own = events.filter((e) => e.match_id === match.id && e.status === 'confirmed');
  const sets = [...new Set([...Object.keys(p.sets).map(Number), ...own.map((e) => e.set_no ?? 1)])].sort((a, b) => a - b);
  const custom = (k: Side) => (['Near', 'Far', ''].includes(p.names[k]?.trim() ?? '') ? null : p.names[k]);
  const out: SideSet[] = [];
  for (const set of sets) {
    for (const side of ['a', 'b'] as Side[]) {
      const evs = own.filter((e) => (e.set_no ?? 1) === set && (e.view ?? 'a') === side);
      const ids = p.sets[String(set)]?.[side] ?? [];
      if (!evs.length && !ids.length) continue;
      const lineup = (side === 'a' ? match.lineups?.[String(set)] : p.lineupsB?.[String(set)]) ?? null;
      const setter = setterOf(evs, ids, lineup, players);
      let pf = 0, pa = 0;
      for (const e of evs) { const s = scoreOf(e); if (s === 'us') pf++; else if (s === 'them') pa++; }
      const ph = phaseScoring(buildRallies(evs));
      const perPlayer = new Map<number, StatLine>();
      for (const id of new Set([...ids, ...evs.map((e) => e.player_id).filter((x): x is number => x != null)])) {
        perPlayer.set(id, statLine(evs.filter((e) => e.player_id === id)));
      }
      const rotations = [1, 2, 3, 4, 5, 6].map((pos) => ({ pos, serving: 0, breaks: 0, receiving: 0, sideOuts: 0 }));
      if (lineup && setter != null) {
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
        label: name ?? (setter != null ? `${firstName(players.find((x) => x.id === setter))} setting` : side === 'a' ? 'Side 1' : 'Side 2'),
        roleOf: rolesFrom(lineup, setter, ids, players),
        pointsFor: pf, pointsAgainst: pa, sideoutPct: ph.sideoutPct, breakPct: ph.breakPct,
        line: statLine(evs.filter((e) => e.player_id != null)), perPlayer, rotations, events: evs,
      });
    }
  }
  // Two sides with the same setter's name in a set (e.g. none found): tell them apart.
  for (const set of sets) {
    const two = out.filter((s) => s.set === set);
    if (two.length === 2 && two[0].label === two[1].label) { two[0].label += ' (1)'; two[1].label += ' (2)'; }
  }
  return out;
}

export interface Pairing { setter: number; hitter: number; attempts: number; kills: number; errors: number; eff: number }

/** Each setter with each hitter: the attacks right after that setter's set, across the match. */
export function setterHitter(events: VEvent[]): Pairing[] {
  const m = new Map<string, Pairing>();
  const rallies: Rally[] = buildRallies(events.filter((e) => e.status === 'confirmed'));
  for (const r of rallies) {
    for (let i = 1; i < r.touches.length; i++) {
      const a = r.touches[i], s = r.touches[i - 1];
      if (!ATTACKS.includes(a.action) || !SETS.includes(s.action) || a.player_id == null || s.player_id == null || a.player_id === s.player_id) continue;
      const k = `${s.player_id}:${a.player_id}`;
      const row = m.get(k) ?? { setter: s.player_id, hitter: a.player_id, attempts: 0, kills: 0, errors: 0, eff: 0 };
      row.attempts++;
      if (a.action === 'kill') row.kills++;
      if (a.action === 'attack_error' || a.action === 'attack_blocked') row.errors++;
      m.set(k, row);
    }
  }
  return [...m.values()].map((r) => ({ ...r, eff: (r.kills - r.errors) / r.attempts }));
}

export interface PlayerSet {
  set: number; side: SideSet; role: SlotRole | null; setter: number | null;
  line: StatLine; won: boolean | null; diff: number;
}

/** One player's sets: on which side, in which position, with which setter, and how it went. */
export function playerTimeline(id: number, sides: SideSet[]): PlayerSet[] {
  return sides
    .filter((s) => s.players.includes(id) || (s.perPlayer.get(id)?.attempts ?? 0) + (s.perPlayer.get(id)?.receptions ?? 0) + (s.perPlayer.get(id)?.serves ?? 0) > 0)
    .map((s) => ({
      set: s.set, side: s, role: s.roleOf.get(id) ?? null, setter: s.setter,
      line: s.perPlayer.get(id) ?? statLine([]),
      won: s.pointsFor === s.pointsAgainst ? null : s.pointsFor > s.pointsAgainst,
      diff: s.pointsFor - s.pointsAgainst,
    }));
}

export interface Together { a: number; b: number; sets: number; diff: number; won: number }

/** Pairs of players on the same side: the sets they played together and the side's point difference then. */
export function together(sides: SideSet[]): Together[] {
  const m = new Map<string, Together>();
  for (const s of sides) {
    const ids = [...new Set(s.players)].sort((x, y) => x - y);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = `${ids[i]}:${ids[j]}`;
      const row = m.get(k) ?? { a: ids[i], b: ids[j], sets: 0, diff: 0, won: 0 };
      row.sets++; row.diff += s.pointsFor - s.pointsAgainst; if (s.pointsFor > s.pointsAgainst) row.won++;
      m.set(k, row);
    }
  }
  return [...m.values()];
}

/** A player's single number for a set: points scored minus errors, per touch involvement. */
export const plusMinus = (l: StatLine) => l.plusMinus;

export interface Change { player: number; from: PlayerSet; to: PlayerSet; what: string[]; delta: number }

/** From one set to the next: who changed side, position or setter, and their +/- before and after. */
export function changes(players: Player[], sides: SideSet[]): Change[] {
  const out: Change[] = [];
  const ids = new Set(sides.flatMap((s) => s.players));
  for (const id of ids) {
    const tl = playerTimeline(id, sides);
    for (let i = 1; i < tl.length; i++) {
      const from = tl[i - 1], to = tl[i];
      const what: string[] = [];
      const mates = (s: SideSet) => new Set(s.players.filter((x) => x !== id));
      const before = mates(from.side), after = mates(to.side);
      const kept = [...after].filter((x) => before.has(x)).length;
      if (from.role && to.role && from.role !== to.role) what.push(`${SLOT_NAMES[from.role]} → ${SLOT_NAMES[to.role]}`);
      if (from.setter !== to.setter && to.setter !== id && from.setter !== id) what.push(`setter ${who(players.find((p) => p.id === from.setter))} → ${who(players.find((p) => p.id === to.setter))}`);
      if (after.size && kept <= after.size / 2) what.push(`mostly new teammates (${kept} of ${after.size} stayed)`);
      if (!what.length) continue;
      // Nothing tagged for them in either set: nothing to compare.
      const touched = (l: StatLine) => l.attempts + l.receptions + l.serves + l.sets + l.digs + l.blockPoints + l.blockTouches + l.errors > 0;
      if (!touched(from.line) && !touched(to.line)) continue;
      out.push({ player: id, from, to, what, delta: to.line.plusMinus - from.line.plusMinus });
    }
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export interface Finding { text: string; tone: 'good' | 'bad' | 'info' }

/** The few things the numbers say most clearly, worded with a caution when the sample is small. */
export function findings(players: Player[], sides: SideSet[], events: VEvent[]): Finding[] {
  const name = (id: number | null) => who(players.find((p) => p.id === id));
  const out: Finding[] = [];
  const pairs = setterHitter(events).filter((r) => r.attempts >= 4).sort((a, b) => b.eff - a.eff || b.attempts - a.attempts);
  if (pairs.length) {
    const b = pairs[0];
    out.push({ tone: 'good', text: `Best setter and hitter: ${name(b.setter)} setting ${name(b.hitter)}: ${b.kills} kills, ${b.errors} errors in ${b.attempts} attacks.` });
    // The same hitter with another setter, for comparison.
    const other = pairs.filter((r) => r.hitter === b.hitter && r.setter !== b.setter).sort((x, y) => x.eff - y.eff)[0];
    if (other) out.push({ tone: 'info', text: `${name(b.hitter)} with ${name(other.setter)} setting: ${other.kills} kills, ${other.errors} errors in ${other.attempts}.` });
    const w = pairs[pairs.length - 1];
    if (pairs.length > 1 && w.eff < 0.1) out.push({ tone: 'bad', text: `Did not work yet: ${name(w.setter)} setting ${name(w.hitter)}: ${w.kills} kills, ${w.errors} errors in ${w.attempts}.` });
  }
  // Setters: their side's results over all the sets they set.
  const bySetter = new Map<number, { sets: number; won: number; diff: number }>();
  for (const s of sides) {
    if (s.setter == null || s.pointsFor + s.pointsAgainst === 0) continue;
    const r = bySetter.get(s.setter) ?? { sets: 0, won: 0, diff: 0 };
    r.sets++; r.diff += s.pointsFor - s.pointsAgainst; if (s.pointsFor > s.pointsAgainst) r.won++;
    bySetter.set(s.setter, r);
  }
  if (bySetter.size > 1) {
    const list = [...bySetter].sort((a, b) => b[1].diff - a[1].diff);
    const [id, r] = list[0];
    out.push({ tone: 'good', text: `With ${name(id)} setting the side won ${r.won} of ${r.sets} set${r.sets === 1 ? '' : 's'} (${r.diff > 0 ? '+' : ''}${r.diff} points).` });
  }
  const tg = together(sides).filter((t) => t.sets >= 2).sort((a, b) => b.diff - a.diff);
  if (tg.length) {
    const t = tg[0];
    if (t.diff > 0) out.push({ tone: 'good', text: `Worked well together: ${name(t.a)} and ${name(t.b)}, on the same side in ${t.sets} sets, ${t.won} won (+${t.diff} points).` });
    const l = tg[tg.length - 1];
    if (tg.length > 1 && l.diff < 0) out.push({ tone: 'bad', text: `Less so: ${name(l.a)} and ${name(l.b)}, together in ${l.sets} sets, ${l.won} won (${l.diff} points).` });
  }
  const ch = changes(players, sides).filter((c) => Math.abs(c.delta) >= 3);
  for (const c of ch.slice(0, 2)) {
    out.push({ tone: c.delta > 0 ? 'good' : 'bad', text: `${name(c.player)}, set ${c.from.set} → ${c.to.set} (${c.what.join(', ')}): +/- ${c.from.line.plusMinus} → ${c.to.line.plusMinus}.` });
  }
  return out;
}
