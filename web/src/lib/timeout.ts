import { ACTION_BY_CODE, isGap, scoreOf } from './actions';
import type { Player, VEvent } from './api';
import type { Rates } from './simulate';

/**
 * What to say at a time-out, from the tags of the set so far: the last rallies (how the points
 * came and went), side-out and break today against the season, who is hot and who struggles,
 * and a few talking points. Everything counts confirmed tags of the current set only.
 */

export interface Brief {
  score: { us: number; them: number };
  /** The last [window] rallies of the set. */
  recent: { n: number; won: number; ourErrors: number; theirWinners: number; kills: number; aces: number; blocks: number; oppErrors: number };
  sideout: { won: number; n: number }; brk: { won: number; n: number };
  /** Our longest run of points against in the set, and the current run. */
  run: { side: 'us' | 'them'; length: number } | null;
  attackers: { player: Player; kills: number; errors: number; attempts: number }[];
  passers: { player: Player; n: number; avg: number }[];
  points: string[];
}

const WINDOW = 10;
const pct = (a: number, n: number) => `${Math.round((a / n) * 100)}%`;
const who = (p: Player) => `#${p.number ?? '?'}${p.name && !/^#?\d+$/.test(p.name.trim()) ? ` ${p.name.split(' ')[0]}` : ''}`;
const isError = (e: VEvent) => scoreOf(e) === 'them' && ACTION_BY_CODE[e.action]?.needsPlayer !== false;
// The last rallies: untagged points are left out (nothing is known about them).

export function timeoutBrief(events: VEvent[], set: number, players: Player[], season?: Rates | null): Brief {
  const ev = events.filter((e) => e.status === 'confirmed' && (e.set_no ?? 1) === set).sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.id - b.id);
  const ends = ev.filter((e) => scoreOf(e));
  const score = { us: ends.filter((e) => scoreOf(e) === 'us').length, them: ends.filter((e) => scoreOf(e) === 'them').length };
  const last = ends.filter((e) => !isGap(e)).slice(-WINDOW);
  const count = (f: (e: VEvent) => boolean) => last.filter(f).length;
  const recent = {
    n: last.length, won: count((e) => scoreOf(e) === 'us'), ourErrors: count(isError), theirWinners: count((e) => e.action === 'opp_point'),
    kills: count((e) => e.action === 'kill'), aces: count((e) => e.action === 'ace'), blocks: count((e) => e.action === 'block_point'), oppErrors: count((e) => e.action === 'opp_error'),
  };
  const sideout = { won: 0, n: 0 }, brk = { won: 0, n: 0 };
  for (let i = 1; i < ends.length; i++) {
    if (isGap(ends[i]) || isGap(ends[i - 1])) continue;
    const t = scoreOf(ends[i - 1]) === 'us' ? brk : sideout;
    t.n++;
    if (scoreOf(ends[i]) === 'us') t.won++;
  }
  let run: Brief['run'] = null;
  if (ends.length) {
    const side = scoreOf(ends[ends.length - 1])!;
    let length = 0;
    for (let i = ends.length - 1; i >= 0 && scoreOf(ends[i]) === side; i--) length++;
    run = { side, length };
  }
  const byId = new Map(players.map((p) => [p.id, p]));
  const att = new Map<number, Brief['attackers'][number]>();
  const pas = new Map<number, { player: Player; n: number; sum: number }>();
  for (const e of ev) {
    const p = e.player_id != null ? byId.get(e.player_id) : undefined;
    if (!p) continue;
    if (['attack', 'kill', 'attack_error', 'attack_blocked'].includes(e.action)) {
      const r = att.get(p.id) ?? { player: p, kills: 0, errors: 0, attempts: 0 };
      r.attempts++;
      if (e.action === 'kill') r.kills++;
      if (e.action !== 'attack' && e.action !== 'kill') r.errors++;
      att.set(p.id, r);
    }
    if (e.action === 'receive' && e.value != null) {
      const r = pas.get(p.id) ?? { player: p, n: 0, sum: 0 };
      r.n++; r.sum += e.value;
      pas.set(p.id, r);
    }
  }
  const attackers = [...att.values()].sort((a, b) => (b.kills - b.errors) - (a.kills - a.errors) || b.attempts - a.attempts);
  const passers = [...pas.values()].map((r) => ({ player: r.player, n: r.n, avg: r.sum / r.n })).sort((a, b) => a.avg - b.avg);

  // Talking points: only what the numbers clearly say.
  const points: string[] = [];
  if (recent.n >= 5) {
    const lost = recent.n - recent.won;
    if (lost >= 3 && recent.ourErrors / lost >= 0.5) points.push(`${recent.ourErrors} of the ${lost} points lost in the last ${recent.n} rallies were our own errors: play safer, keep the ball in.`);
    else if (lost >= 3 && recent.theirWinners / lost >= 0.5) points.push(`They won ${recent.theirWinners} of their last ${lost} points with winners: adjust block and defence.`);
  }
  if (sideout.n >= 5) {
    const today = sideout.won / sideout.n;
    const ref = season && season.n.receiving >= 30 ? season.overall.sideout : null;
    if (ref != null && today < ref - 0.1) points.push(`Side-out ${pct(sideout.won, sideout.n)} this set (season ${Math.round(ref * 100)}%): the first ball after their serve is the problem.`);
    else if (today < 0.45) points.push(`Side-out only ${pct(sideout.won, sideout.n)} this set: focus on the pass and a safe first attack.`);
  }
  if (brk.n >= 5) {
    const ref = season && season.n.serving >= 30 ? season.overall.brk : null;
    if (ref != null && brk.won / brk.n < ref - 0.12) points.push(`Break points ${pct(brk.won, brk.n)} this set (season ${Math.round(ref * 100)}%): serve tougher, but in.`);
  }
  const weak = passers.find((p) => p.n >= 4 && p.avg < 1.5);
  if (weak) points.push(`${who(weak.player)} passes ${weak.avg.toFixed(1)} on ${weak.n} this set: help them (narrower zone, a third passer).`);
  const hot = attackers.find((a) => a.attempts >= 3 && a.kills / a.attempts >= 0.5 && a.errors <= 1);
  if (hot) points.push(`${who(hot.player)} is on: ${hot.kills} kills in ${hot.attempts}. Set them more.`);
  const cold = attackers.find((a) => a.attempts >= 3 && a.errors >= 2 && a.errors >= a.kills);
  if (cold && cold !== hot) points.push(`${who(cold.player)}: ${cold.errors} errors and ${cold.kills} kills in ${cold.attempts}. Smarter shots (tip, high off the block).`);
  if (run && run.side === 'them' && run.length >= 3) points.push(`They have won the last ${run.length} points.`);

  return { score, recent, sideout, brk, run, attackers, passers, points };
}
