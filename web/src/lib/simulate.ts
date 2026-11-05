import { lineupsOf } from './practice';
import { isGap, scoreOf } from './actions';
import { rotationStats } from './analysis';
import type { Match, Player, VEvent } from './api';
import type { Lineups } from './rotation';

/**
 * Match simulator. Every tagged rally says who served and who won it; from that each team gets
 * a side-out rate (points won on the other team's serve) and a break rate (points won on its own
 * serve), per rotation when the line-ups are entered. Two teams are then played against each
 * other rally by rally, thousands of times: which starting rotation wins most sets, how likely the
 * match is won, and how much a better side-out or serve would change that.
 *
 * Rates rest on few rallies, so each is pulled towards the team's overall rate, and that one
 * towards a typical amateur league (side-out 58%), in proportion to how little data there is.
 */

/** A typical side-out rate in amateur leagues: the receiving team wins 58% of rallies. */
export const LEAGUE_SIDEOUT = 0.58;
/** Pseudo-rallies of the league rate added to a team's rate, and of the team rate to a rotation's. */
const TEAM_PRIOR = 20;
const ROTATION_PRIOR = 10;

export interface Rates {
  /** Index 0..5 = rotation with the setter in position 1..6. */
  sideout: number[]; brk: number[];
  overall: { sideout: number; brk: number };
  /** Rallies behind the rates. */
  n: { receiving: number; serving: number };
  /** Whether the rates differ per rotation (line-ups entered). */
  byRotation: boolean;
  /** Raw counts per rotation (only with line-ups). */
  rotations: { receiving: number; sideOuts: number; serving: number; breaks: number }[] | null;
}

/** A team nobody tagged yet: league-typical in every rotation. */
export const AVERAGE_TEAM: Rates = {
  sideout: Array(6).fill(LEAGUE_SIDEOUT), brk: Array(6).fill(1 - LEAGUE_SIDEOUT),
  overall: { sideout: LEAGUE_SIDEOUT, brk: 1 - LEAGUE_SIDEOUT }, n: { receiving: 0, serving: 0 }, byRotation: false, rotations: null,
};

const shrink = (wins: number, n: number, prior: number, k: number) => (wins + k * prior) / (n + k);

/**
 * Side-out and break rates of a team from its tagged matches. Who served a rally is who won the
 * one before (the first rally of a set is skipped without a line-up), so this needs no line-up;
 * per rotation it does.
 */
export function teamRates(events: VEvent[], matches: Pick<Match, 'id' | 'lineups'>[], players: Player[]): Rates {
  const sets = new Map<string, VEvent[]>();
  for (const e of events) {
    if (e.status !== 'confirmed' || !scoreOf(e)) continue;
    const k = `${e.match_id}:${e.set_no ?? 1}${e.view === 'b' ? ':b' : ''}`;
    if (!sets.has(k)) sets.set(k, []);
    sets.get(k)!.push(e);
  }
  let rec = 0, so = 0, srv = 0, br = 0;
  for (const list of sets.values()) {
    list.sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.id - b.id);
    for (let i = 1; i < list.length; i++) {
      // Untagged points: their order is made up, so they say nothing about side-out or break.
      if (isGap(list[i]) || isGap(list[i - 1])) continue;
      const weServed = scoreOf(list[i - 1]) === 'us';
      const won = scoreOf(list[i]) === 'us';
      if (weServed) { srv++; if (won) br++; } else { rec++; if (won) so++; }
    }
  }
  const sideout = shrink(so, rec, LEAGUE_SIDEOUT, TEAM_PRIOR);
  const brk = shrink(br, srv, 1 - LEAGUE_SIDEOUT, TEAM_PRIOR);
  const lineups = new Map<number, Lineups | null | undefined>(matches.map((m) => [m.id, lineupsOf(m)]));
  const rot = rotationStats(events, lineups, players);
  const byRotation = rot.reduce((a, r) => a + r.receiving + r.serving, 0) >= 20;
  return {
    sideout: rot.map((r) => (byRotation ? shrink(r.sideOuts, r.receiving, sideout, ROTATION_PRIOR) : sideout)),
    brk: rot.map((r) => (byRotation ? shrink(r.breaks, r.serving, brk, ROTATION_PRIOR) : brk)),
    overall: { sideout, brk }, n: { receiving: rec, serving: srv }, byRotation,
    rotations: byRotation ? rot.map(({ receiving, sideOuts, serving, breaks }) => ({ receiving, sideOuts, serving, breaks })) : null,
  };
}

const odds = (p: number) => p / (1 - p);
const prob = (o: number) => o / (1 + o);
const clamp = (p: number) => Math.min(0.97, Math.max(0.03, p));

/**
 * Chance the serving team wins the rally: its break rate against the receiver's side-out rate,
 * both measured against the league (odds ratio, "log5").
 */
export function serveWin(serverBreak: number, receiverSideout: number): number {
  return clamp(prob(odds(clamp(serverBreak)) * odds(clamp(1 - receiverSideout)) / odds(1 - LEAGUE_SIDEOUT)));
}

/** Next rotation after winning back the serve: the setter moves 1 → 6 → 5 → … → 2 → 1. */
export const nextRotation = (setterPos: number) => (setterPos === 1 ? 6 : setterPos - 1);

/** Small fast seeded random numbers (mulberry32), so a simulation gives the same answer twice. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One set; returns whether we won. Rotations are the setter's position (1..6). */
export function playSet(us: Rates, them: Rates, start: { us: number; them: number; weServe: boolean }, to: number, rand: () => number): boolean {
  let a = 0, b = 0, ru = start.us, rt = start.them, weServe = start.weServe;
  for (;;) {
    const p = weServe ? serveWin(us.brk[ru - 1], them.sideout[rt - 1]) : serveWin(them.brk[rt - 1], us.sideout[ru - 1]);
    const serverWins = rand() < p;
    const weWin = weServe === serverWins;
    if (weWin) { a++; if (!weServe) { weServe = true; ru = nextRotation(ru); } } else { b++; if (weServe) { weServe = false; rt = nextRotation(rt); } }
    if ((a >= to || b >= to) && Math.abs(a - b) >= 2) return a > b;
  }
}

/** Chance of winning a best-of-five match from the set chances (sets 1-4 to 25, the fifth to 15). */
export function matchWin(p25: number, p15: number): number {
  // At least 3 of the first 4 sets (same as winning 3-0 or 3-1), or 2-2 and the fifth.
  const q = 1 - p25;
  const threeOrMore = p25 ** 4 + 4 * p25 ** 3 * q;
  const twoTwo = 6 * p25 ** 2 * q ** 2;
  return threeOrMore + twoTwo * p15;
}

export interface SimResult {
  /** Set win chance with our setter starting in position 1..6 (index 0..5), against any start of theirs. */
  byStart: number[];
  best: number;
  setWin: number; tieBreakWin: number; match: number;
}

/** Plays [n] sets for each of our starting rotations against every start of theirs, both serving first. */
export function simulate(us: Rates, them: Rates, n = 150, seed = 7): SimResult {
  const rand = rng(seed);
  const run = (to: number, start: number) => {
    let won = 0, total = 0;
    for (let theirs = 1; theirs <= 6; theirs++) {
      for (const weServe of [true, false]) {
        for (let i = 0; i < n; i++) { if (playSet(us, them, { us: start, them: theirs, weServe }, to, rand)) won++; total++; }
      }
    }
    return won / total;
  };
  const byStart = [1, 2, 3, 4, 5, 6].map((s) => run(25, s));
  const best = byStart.indexOf(Math.max(...byStart)) + 1;
  const tieBreakWin = run(15, best);
  return { byStart, best, setWin: byStart[best - 1], tieBreakWin, match: matchWin(byStart[best - 1], tieBreakWin) };
}

export interface Lever { key: string; label: string; why: string; match: number; delta: number }

/**
 * What would help most: the same simulation with one thing better. Side-out comes from passing
 * and the first attack; break points from serving, blocking and defence.
 */
export function levers(us: Rates, them: Rates, base: SimResult, n = 150): Lever[] {
  const up = (r: number[], d: number) => r.map((x) => Math.min(0.95, x + d));
  const variants: { key: string; label: string; why: string; rates: Rates }[] = [
    { key: 'sideout', label: 'Side-out +5 points (%)', why: 'better passing and first attack', rates: { ...us, sideout: up(us.sideout, 0.05) } },
    { key: 'break', label: 'Break points +5 points (%)', why: 'tougher serves, block and defence', rates: { ...us, brk: up(us.brk, 0.05) } },
  ];
  if (us.byRotation) {
    const worst = us.sideout.indexOf(Math.min(...us.sideout));
    variants.push({
      key: 'worst', label: `Rotation ${worst + 1} up to our average side-out`, why: 'fix the weakest rotation (reception pattern, who attacks there)',
      rates: { ...us, sideout: us.sideout.map((x, i) => (i === worst ? Math.max(x, us.overall.sideout) : x)) },
    });
  }
  return variants.map((v) => {
    const r = simulate(v.rates, them, n);
    return { key: v.key, label: v.label, why: v.why, match: r.match, delta: r.match - base.match };
  }).sort((a, b) => b.delta - a.delta);
}
