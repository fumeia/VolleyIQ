import { ACTION_BY_CODE, isGap, scoreOf, type ActionCode } from './actions';
import type { VEvent } from './api';
import { receiveGrade } from './court';

/**
 * Rallies rebuilt from the saved tags of a match (or season). Tags are our own
 * touches in video order; a rally ends with the tag that scored (a kill, an ace,
 * an error, or the opponent's error/winner added by "We won / They won"). From
 * the order of the touches we know how each attack came about: after our pass
 * (side-out / first ball) or after a dig, block or free ball (transition).
 */

export const ATTACKS: ActionCode[] = ['attack', 'kill', 'attack_error', 'attack_blocked'];
export const SETS: ActionCode[] = ['set', 'assist', 'set_error', 'assist_error'];
export const SERVES: ActionCode[] = ['serve', 'ace', 'serve_error'];
/** Touches that start one of our possessions (the ball comes over from the opponent). */
export const FIRST_CONTACTS: ActionCode[] = ['receive', 'dig', 'dig_error', 'freeball', 'block_touch'];

export interface Rally {
  match: number;
  set: number;
  /** Our touches (team-level events like an opponent error are left out). */
  touches: VEvent[];
  /** The tag that ended the rally, ours or a team event; null if the rally is unfinished. */
  end: VEvent | null;
  won: boolean | null;
  /** From the first touch: a serve means we served, a pass means they did. */
  weServed: boolean | null;
}

const isTeam = (e: VEvent) => ACTION_BY_CODE[e.action]?.needsPlayer === false;
const byTime = (a: VEvent, b: VEvent) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.id - b.id;

export function buildRallies(events: VEvent[]): Rally[] {
  // A block without a touch is not a ball contact: it takes no place in the rally.
  // Points nobody tagged have no rally to rebuild.
  const confirmed = events.filter((e) => e.status === 'confirmed' && e.action !== 'block_miss' && !isGap(e));
  const bySet = new Map<string, VEvent[]>();
  for (const e of confirmed) {
    // Matches are kept apart in a season: rallies never span two matches.
    const key = `${e.match_id}:${e.set_no ?? 1}${e.view === 'b' ? ':b' : ''}`;
    const list = bySet.get(key);
    if (list) list.push(e); else bySet.set(key, [e]);
  }
  const out: Rally[] = [];
  for (const list of bySet.values()) {
    list.sort(byTime);
    let cur: VEvent[] = [];
    const close = (end: VEvent | null) => {
      const touches = cur.filter((e) => !isTeam(e));
      if (!touches.length && !end) return;
      const first = touches[0]?.action;
      const score = end ? scoreOf(end) : undefined;
      out.push({
        match: list[0].match_id,
        set: list[0].set_no ?? 1,
        touches,
        end,
        won: score === 'us' ? true : score === 'them' ? false : null,
        weServed: first == null ? null : SERVES.includes(first) ? true : first === 'receive' ? false : null,
      });
      cur = [];
    };
    for (const e of list) {
      cur.push(e);
      if (scoreOf(e)) close(e);
    }
    close(null);
  }
  return out;
}

/** How the opponent won a rally, from the tag that ended it. */
export type TheirPoint = 'attack' | 'block' | 'ace' | 'unforced' | 'unknown';
export const THEIR_POINTS: { key: TheirPoint; label: string }[] = [
  { key: 'attack', label: 'Their attack' }, { key: 'block', label: 'Their block' },
  { key: 'ace', label: 'Their ace' }, { key: 'unforced', label: 'Our unforced error' },
  { key: 'unknown', label: 'Not specified' },
];

/**
 * A lost rally by what ended it. A dig or block that could not keep their attack in
 * play is their attack; a blocked attack is their block; a pass graded 0 is their ace;
 * serve, attack (out / net) and set errors are ours alone. "They won" carries the kind
 * in its value when it was given (1 attack, 2 block, 3 ace).
 */
export function theirPoint(end: VEvent): TheirPoint {
  if (end.action === 'attack_blocked') return 'block';
  if (end.action === 'receive') return 'ace';
  if (end.action === 'dig_error' || end.action === 'block_error') return 'attack';
  if (end.action === 'opp_point') return end.value === 1 ? 'attack' : end.value === 2 ? 'block' : end.value === 3 ? 'ace' : 'unknown';
  return 'unforced';
}

/** Where a point of theirs landed on our side: the spot of the touch that missed, or of "They won". */
export function theirPointSpot(end: VEvent): { x: number; y: number } | null {
  if ((end.action === 'dig_error' || end.action === 'receive') && end.fx != null && end.fy != null) return { x: end.fx, y: end.fy };
  if (end.action === 'opp_point' && end.x != null && end.y != null) return { x: end.x, y: end.y };
  return null;
}

export type Phase = 'sideout' | 'transition' | 'unknown';

export interface AttackContext {
  attack: VEvent;
  /** The set right before the attack in the same possession (if tagged). */
  set: VEvent | null;
  /** The first contact of the possession: a pass, dig, free ball or block touch. */
  origin: VEvent | null;
  phase: Phase;
  /** Quality 0..3 of the first contact: the pass grade, or where the dig/free ball went. */
  quality: number | null;
  rally: Rally;
}

/** Quality 0..3 of a first contact: the receive grade, or the grade its landing spot implies. */
export function contactQuality(e: VEvent): number | null {
  if (e.action === 'receive') return e.value ?? null;
  if (e.action === 'dig_error') return 0;
  if (e.x != null && e.y != null) return receiveGrade({ x: e.x, y: e.y });
  return null;
}

/** Each of our attacks with the touches that led to it. */
export function attackContexts(rallies: Rally[]): AttackContext[] {
  const out: AttackContext[] = [];
  for (const rally of rallies) {
    let set: VEvent | null = null;
    let origin: VEvent | null = null;
    for (const e of rally.touches) {
      if (FIRST_CONTACTS.includes(e.action)) { origin = e; set = null; continue; }
      if (SETS.includes(e.action)) { set = e; continue; }
      if (SERVES.includes(e.action)) { origin = null; set = null; continue; }
      if (ATTACKS.includes(e.action)) {
        const phase: Phase = !origin ? 'unknown' : origin.action === 'receive' ? 'sideout' : 'transition';
        out.push({ attack: e, set, origin, phase, quality: origin ? contactQuality(origin) : null, rally });
        // The next attack needs a new first contact (after the opponent played the ball back).
        origin = null; set = null;
      }
    }
  }
  return out;
}

/**
 * Real assists: a set (by anyone) whose next touch is our kill. The "assist" action
 * itself is used for a bump set by a non-setter, so it is not counted as an assist.
 */
export function realAssists(rallies: Rally[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rallies) {
    r.touches.forEach((e, i) => {
      const next = r.touches[i + 1];
      if (SETS.includes(e.action) && next?.action === 'kill' && e.player_id != null) {
        out.set(e.player_id, (out.get(e.player_id) ?? 0) + 1);
      }
    });
  }
  return out;
}

export interface Ratio { won: number; n: number }
const pct = (r: Ratio) => (r.n ? r.won / r.n : null);

/**
 * Side-out % (rallies they served that we won) and break-point % (rallies we served
 * that we won), from the tags alone: no line-up needed.
 */
export function phaseScoring(rallies: Rally[]) {
  const sideout: Ratio = { won: 0, n: 0 };
  const brk: Ratio = { won: 0, n: 0 };
  for (const r of rallies) {
    if (r.won == null || r.weServed == null) continue;
    const t = r.weServed ? brk : sideout;
    t.n++;
    if (r.won) t.won++;
  }
  return { sideout, break: brk, sideoutPct: pct(sideout), breakPct: pct(brk) };
}

/** Win % by how many touches we had in the rally (short rallies vs long ones). */
export function winByLength(rallies: Rally[]): { label: string; won: number; n: number }[] {
  const buckets = [
    { label: '1 touch', min: 1, max: 1 },
    { label: '2–3', min: 2, max: 3 },
    { label: '4–6', min: 4, max: 6 },
    { label: '7+', min: 7, max: Infinity },
  ].map((b) => ({ ...b, won: 0, n: 0 }));
  for (const r of rallies) {
    if (r.won == null || !r.touches.length) continue;
    const b = buckets.find((x) => r.touches.length >= x.min && r.touches.length <= x.max);
    if (!b) continue;
    b.n++;
    if (r.won) b.won++;
  }
  return buckets.map(({ label, won, n }) => ({ label, won, n }));
}

export interface Possession {
  /** The touches of one transition possession: a dig / free ball (after a block touch, both). */
  touches: VEvent[];
  result: 'kill' | 'error' | 'none';
}

/**
 * Our transition possessions: they start with a dig, free ball or block touch and
 * run until our kill, our error, or the ball going back over (the next first contact).
 * A block touch and the dig right after it are one possession.
 */
export function transitionPossessions(rallies: Rally[]): Possession[] {
  const out: Possession[] = [];
  const START = ['dig', 'dig_error', 'freeball', 'block_touch'];
  for (const r of rallies) {
    const ts = r.touches;
    for (let i = 0; i < ts.length; i++) {
      const e = ts[i];
      if (!START.includes(e.action)) continue;
      // The dig after our own block touch belongs to the block touch's possession.
      if (e.action !== 'block_touch' && ts[i - 1]?.action === 'block_touch') continue;
      const touches = [e];
      let result: Possession['result'] = e.action === 'dig_error' ? 'error' : 'none';
      let j = i + 1;
      if (result === 'none' && e.action === 'block_touch' && ts[j] && ['dig', 'dig_error', 'freeball'].includes(ts[j].action)) {
        touches.push(ts[j]);
        if (ts[j].action === 'dig_error') result = 'error';
        j++;
      }
      for (; result === 'none' && j < ts.length; j++) {
        const x = ts[j];
        if (FIRST_CONTACTS.includes(x.action)) break;
        touches.push(x);
        if (x.action === 'kill') result = 'kill';
        else if (scoreOf(x) === 'them') result = 'error';
      }
      out.push({ touches, result });
    }
  }
  return out;
}

/**
 * Transition: of our possessions after a dig, free ball or block touch, how many we
 * turned into a kill, and how many ended with our error.
 */
export function transitionConversion(rallies: Rally[]) {
  const ps = transitionPossessions(rallies).filter((p) => p.touches[0].action !== 'dig_error');
  const kills = ps.filter((p) => p.result === 'kill').length;
  const errors = ps.filter((p) => p.result === 'error').length;
  return { n: ps.length, kills, errors, killPct: ps.length ? kills / ps.length : null };
}

export interface Score { us: number; them: number }

/** Each finished rally with the score before it (per match and set). */
export function withScore(rallies: Rally[]): { rally: Rally; before: Score }[] {
  const out: { rally: Rally; before: Score }[] = [];
  const cur = new Map<string, Score>();
  for (const r of rallies) {
    const key = `${r.match}:${r.set}`;
    const s = cur.get(key) ?? { us: 0, them: 0 };
    out.push({ rally: r, before: { ...s } });
    if (r.won === true) s.us++;
    else if (r.won === false) s.them++;
    cur.set(key, s);
  }
  return out;
}

export interface Run { match: number; set: number; side: 'us' | 'them'; length: number; from: Score; to: Score; rallies: Rally[] }

/** Scoring runs of [min]+ points in a row for one side, with the rallies in them. */
export function scoringRuns(rallies: Rally[], min = 4): Run[] {
  const out: Run[] = [];
  let run: Run | null = null;
  let key = '';
  const close = () => { if (run && run.length >= min) out.push(run); run = null; };
  for (const { rally, before } of withScore(rallies)) {
    if (rally.won == null) continue;
    const k = `${rally.match}:${rally.set}`;
    if (k !== key) { close(); key = k; }
    const side = rally.won ? 'us' : 'them';
    if (run && run.side === side) {
      run.length++;
      run.to = { us: before.us + (rally.won ? 1 : 0), them: before.them + (rally.won ? 0 : 1) };
      run.rallies.push(rally);
    } else {
      close();
      run = { match: rally.match, set: rally.set, side, length: 1, from: before, to: { us: before.us + (rally.won ? 1 : 0), them: before.them + (rally.won ? 0 : 1) }, rallies: [rally] };
    }
  }
  close();
  return out;
}

/** Rallies played at the end of a set (either side on 20+), the "clutch" points. */
export const isClutch = (before: Score, set: number) => Math.max(before.us, before.them) >= (set >= 5 ? 10 : 20);
