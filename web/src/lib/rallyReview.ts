import type { ActionCode } from './actions';
import type { VEvent } from './api';
import type { Calibration } from './calibration';
import { rallyInfo, type RallyInfo } from './rallies';

export interface RallyGroup {
  key: string;
  events: VEvent[];   // in time order
  start: number;
  end: number;
  set: number;
}

/** Set number at video time [t]: one set per side switch of the calibration. */
export function setAt(cal: Calibration | null | undefined, t: number): number {
  return 1 + (cal?.switches ?? []).filter((s) => s.t <= t).length;
}

/** Suggestions grouped into rallies, in time order. */
export function groupRallies(suggested: VEvent[], cal?: Calibration | null): { rallies: RallyGroup[]; info: Map<number, RallyInfo> } {
  const info = rallyInfo(suggested);
  const by = new Map<string, VEvent[]>();
  for (const e of suggested) {
    const k = info.get(e.id)?.rally ?? `t${e.id}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(e);
  }
  const rallies = [...by.entries()].map(([key, list]) => {
    const events = [...list].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    const start = events[0].t ?? 0;
    return { key, events, start, end: events[events.length - 1].t ?? start, set: events.find((e) => e.set_no)?.set_no ?? setAt(cal, start) };
  });
  rallies.sort((a, b) => a.start - b.start);
  return { rallies, info };
}

export type Serving = 'us' | 'them' | null;

/** Is this touch ours, given who served? Possession 0 is the serving team, then they alternate. Unknown = keep. */
export function isOurs(info: RallyInfo | undefined, serving: Serving): boolean {
  if (!info || serving == null) return true;
  return (info.poss % 2 === 0) === (serving === 'us');
}

/**
 * Who served, when the suggestions already tell: the app drops the opponent's touches
 * once it knows the teams, which leaves only one possession parity.
 */
export function guessServing(events: VEvent[], info: Map<number, RallyInfo>): Serving {
  const parities = new Set(events.map((e) => info.get(e.id)?.poss).filter((p): p is number => p != null).map((p) => p % 2));
  if (parities.size !== 1) return null;
  return parities.has(0) ? 'us' : 'them';
}

const POINT_OF: Partial<Record<ActionCode, ActionCode>> = {
  attack: 'kill', kill: 'kill', serve: 'ace', ace: 'ace', block_touch: 'block_point', block_point: 'block_point',
};
const ERROR_OF: Partial<Record<ActionCode, ActionCode>> = {
  attack: 'attack_error', kill: 'attack_error', attack_error: 'attack_error', attack_blocked: 'attack_blocked',
  serve: 'serve_error', ace: 'serve_error', serve_error: 'serve_error',
  set: 'set_error', assist: 'set_error', set_error: 'set_error', assist_error: 'assist_error',
  dig: 'dig_error', freeball: 'dig_error', dig_error: 'dig_error',
  block_touch: 'block_error', block_point: 'block_error', block_error: 'block_error',
  receive: 'receive',
};

export interface Outcome {
  /** Change the last touch to the point/error it was (e.g. attack -> kill). */
  change?: { id: number; action: ActionCode; value?: number | null };
  /** And/or add a team event (the opponent's error or winner), with [addValue] (opp_point: 1 attack, 2 block, 3 ace). */
  add?: ActionCode;
  addValue?: number;
}

/**
 * How the rally ended, from who won it and who touched the ball last. Our last touch
 * becomes the point (kill, ace, block point) or the error (attack error, serve error,
 * a 0-pass, ...); when the opponent touched last it is their error or their winner.
 */
export function outcome(last: { id: number; action: ActionCode } | null, lastIsOurs: boolean, weWon: boolean): Outcome {
  if (!last || !lastIsOurs) return { add: weWon ? 'opp_error' : 'opp_point' };
  if (weWon) {
    const p = POINT_OF[last.action];
    return p ? { change: { id: last.id, action: p } } : { add: 'opp_error' };
  }
  const e = ERROR_OF[last.action];
  if (!e) return { add: 'opp_point' };
  // Our last touch a pass: it was their ace (the pass becomes a 0, and their point is added).
  if (e === 'receive') return { change: { id: last.id, action: 'receive', value: 0 }, add: 'opp_point', addValue: 3 };
  return { change: { id: last.id, action: e } };
}

/** Seconds: two suggestions closer than this are the same touch heard twice. */
export const SAME_TOUCH = 0.3;

/**
 * Ids of suggestions that repeat a touch next to them (a quiet sound right after a
 * heard one, two sounds of one contact): the guessed or less sure one goes.
 */
export function duplicates(events: VEvent[]): number[] {
  const sorted = events.filter((e) => e.t != null).sort((a, b) => a.t! - b.t!);
  const out: number[] = [];
  let keep = sorted[0];
  for (const e of sorted.slice(1)) {
    if (e.t! - keep.t! < SAME_TOUCH) {
      const score = (x: VEvent) => (x.hint ? 0 : 1) + (x.player_id != null || x.jersey != null ? 0.5 : 0) + (x.confidence ?? 0);
      if (score(e) > score(keep)) { out.push(keep.id); keep = e; } else out.push(e.id);
    } else keep = e;
  }
  return out;
}

/** Suggestions within [SAME_TOUCH] s of a saved event: that touch is already recorded. */
export function alreadySaved(events: VEvent[], saved: VEvent[]): number[] {
  const times = saved.filter((e) => e.t != null).map((e) => e.t!).sort((a, b) => a - b);
  const near = (t: number) => {
    let lo = 0, hi = times.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; }
    return [lo - 1, lo].some((i) => i >= 0 && i < times.length && Math.abs(times[i] - t) < SAME_TOUCH);
  };
  return events.filter((e) => e.t != null && near(e.t)).map((e) => e.id);
}

/**
 * Who serves a rally starting at video time [t]: the winner of the last saved point
 * of the set before it, else the line-up's first server; null when neither is known.
 */
export function servingAt(points: ('us' | 'them')[], weServeFirst: boolean | null | undefined): Serving {
  if (points.length) return points[points.length - 1];
  return weServeFirst == null ? null : weServeFirst ? 'us' : 'them';
}

/**
 * The touches of a typical rally starting at [t], to fix up instead of tagging from
 * scratch: on our serve the serve and our dig of their attack; on theirs their serve,
 * then our pass, set and attack. [poss] 0 is the serving team (so the side follows).
 */
export function rallyTemplate(t: number, serving: Serving): { t: number; action: ActionCode; poss: number }[] {
  const at = (dt: number) => Math.round((t + dt) * 100) / 100;
  if (serving === 'us') return [{ t: at(0), action: 'serve', poss: 0 }, { t: at(3.5), action: 'dig', poss: 2 }];
  return [
    { t: at(0), action: 'serve', poss: 0 },
    { t: at(1), action: 'receive', poss: 1 },
    { t: at(2), action: 'set', poss: 1 },
    { t: at(3), action: 'attack', poss: 1 },
  ];
}
