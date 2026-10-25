import { ACTION_BY_CODE, type ActionCode } from './actions';
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
  const confirmed = events.filter((e) => e.status === 'confirmed');
  const bySet = new Map<string, VEvent[]>();
  for (const e of confirmed) {
    // Matches are kept apart in a season: rallies never span two matches.
    const key = `${e.match_id}:${e.set_no ?? 1}`;
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
      const score = end ? ACTION_BY_CODE[end.action]?.score : undefined;
      out.push({
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
      if (ACTION_BY_CODE[e.action]?.score) close(e);
    }
    close(null);
  }
  return out;
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

/**
 * Transition: of our digs (and free balls, block touches) that stayed in play, how many
 * possessions we turned into a kill, and how many ended with our error.
 */
export function transitionConversion(rallies: Rally[]) {
  let n = 0, kills = 0, errors = 0;
  for (const r of rallies) {
    r.touches.forEach((e, i) => {
      if (!['dig', 'freeball', 'block_touch'].includes(e.action)) return;
      n++;
      // Follow our possession until the next first contact or the end of the rally.
      for (const x of r.touches.slice(i + 1)) {
        if (FIRST_CONTACTS.includes(x.action)) break;
        if (x.action === 'kill') { kills++; break; }
        if (ACTION_BY_CODE[x.action]?.score === 'them') { errors++; break; }
      }
    });
  }
  return { n, kills, errors, killPct: n ? kills / n : null };
}
