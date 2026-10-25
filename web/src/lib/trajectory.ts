import type { ActionCode } from './actions';
import type { VEvent } from './api';
import { COURT, PASS_TARGET, zoneOf } from './court';

/**
 * What the two tapped spots of a touch tell (where it was played from: fx, fy;
 * where it went: x, y). Our half is y 0..9, the opponent's 9..18, x 0..9 from
 * our left to our right, seen from behind our baseline.
 */

export type Direction = 'line' | 'cross' | 'cut';
export const DIRECTIONS: { key: Direction; label: string }[] = [
  { key: 'line', label: 'Line' }, { key: 'cross', label: 'Cross' }, { key: 'cut', label: 'Sharp cut' },
];

/**
 * Shot direction from its angle to straight ahead: under 15° down the line, up to
 * 50° cross-court (incl. deep cross), beyond that a sharp cut along the net.
 */
export function direction(e: Pick<VEvent, 'fx' | 'fy' | 'x' | 'y'>): Direction | null {
  if (e.fx == null || e.fy == null || e.x == null || e.y == null) return null;
  const dy = e.y - e.fy;
  if (dy < 0.5) return null; // did not travel towards the other side
  const deg = (Math.atan2(Math.abs(e.x - e.fx), dy) * 180) / Math.PI;
  return deg < 15 ? 'line' : deg <= 50 ? 'cross' : 'cut';
}

export type Depth = 'short' | 'mid' | 'deep' | 'out';
export const DEPTHS: { key: Depth; label: string }[] = [
  { key: 'short', label: 'Short (front zone)' }, { key: 'mid', label: 'Middle' }, { key: 'deep', label: 'Deep' }, { key: 'out', label: 'Out' },
];

/** How deep a ball landed on the opponent's side: front zone (≤3 m), middle, deep (last 3 m), or out. */
export function depth(e: Pick<VEvent, 'x' | 'y'>): Depth | null {
  if (e.x == null || e.y == null || e.y < COURT.net) return null;
  if (e.y > COURT.length || e.x < 0 || e.x > COURT.width) return 'out';
  const d = e.y - COURT.net;
  return d <= 3 ? 'short' : d <= 6 ? 'mid' : 'deep';
}

export type ErrorKind = 'net' | 'long' | 'wide' | 'blocked' | 'other';
export const ERROR_KINDS: { key: ErrorKind; label: string }[] = [
  { key: 'net', label: 'Net' }, { key: 'long', label: 'Out long' }, { key: 'wide', label: 'Out wide' },
  { key: 'blocked', label: 'Blocked' }, { key: 'other', label: 'Other' },
];

/** Why an attack or serve error happened, from where the ball went. */
export function errorKind(e: Pick<VEvent, 'action' | 'x' | 'y'>): ErrorKind | null {
  if (e.action === 'attack_blocked') return 'blocked';
  if (e.action !== 'attack_error' && e.action !== 'serve_error') return null;
  if (e.x == null || e.y == null) return 'other';
  if (e.y <= COURT.net + 0.3) return 'net';
  if (e.y > COURT.length) return 'long';
  if (e.x < 0 || e.x > COURT.width) return 'wide';
  return 'other';
}

/**
 * Back-row attackers take off behind the 3 m line but land (and get tapped) in front
 * of it, so contacts up to this far in front of the line still count as back row.
 */
export const BACKROW_REACH = 1;
/** Our side: contacts closer to the net than this (m from our baseline) are front-row attacks. */
export const FRONT_ROW_FROM = COURT.net - COURT.attackLine + BACKROW_REACH;

export type Origin = '4' | '3' | '2' | 'b5' | 'b6' | 'b1';
export const ORIGINS: { key: Origin; label: string }[] = [
  { key: '4', label: 'Zone 4 (left)' }, { key: '3', label: 'Zone 3 (middle)' }, { key: '2', label: 'Zone 2 (right)' },
  { key: 'b5', label: 'Back row left (5)' }, { key: 'b6', label: 'Pipe (6)' }, { key: 'b1', label: 'Back row right (1)' },
];
export const isBackRow = (o: Origin | null) => o != null && o.startsWith('b');

/**
 * Where on our side an attack was hit from: front-row zone 4/3/2, or a back-row
 * attack from 5 / 6 (pipe) / 1 (the zone behind it) when hit at most
 * [BACKROW_REACH] in front of the 3 m line.
 */
export function attackOrigin(e: Pick<VEvent, 'fx' | 'fy'>): Origin | null {
  if (e.fx == null || e.fy == null) return null;
  const x = Math.min(9, Math.max(0, e.fx)), y = Math.min(8.99, Math.max(0, e.fy));
  const col = x < 3 ? 0 : x < 6 ? 1 : 2;
  return y >= FRONT_ROW_FROM ? (['4', '3', '2'] as const)[col] : (['b5', 'b6', 'b1'] as const)[col];
}

/** How far (m) a pass or dig landed from the ideal target (1 m off the net, between zones 3 and 2). */
export function targetDistance(e: Pick<VEvent, 'x' | 'y'>): number | null {
  if (e.x == null || e.y == null) return null;
  return Math.hypot(e.x - PASS_TARGET.x, e.y - PASS_TARGET.y);
}

/** Zone of our court where a ball was played from (passes, digs). */
export const ourZone = (e: Pick<VEvent, 'fx' | 'fy'>) =>
  e.fx == null || e.fy == null ? null : zoneOf({ x: Math.min(9, Math.max(0, e.fx)), y: Math.min(8.99, Math.max(0, e.fy)) });

/** Zone of the opponent's court where a ball landed (serves, attacks), in their numbering. */
export const theirZone = (e: Pick<VEvent, 'x' | 'y'>) =>
  e.x == null || e.y == null || e.y < COURT.net ? null : zoneOf({ x: e.x, y: e.y });

/** Outcome of an attack or serve: point, kept in play, or our error. */
export function result(a: ActionCode): 'point' | 'play' | 'error' | null {
  switch (a) {
    case 'kill': case 'ace': return 'point';
    case 'attack': case 'serve': return 'play';
    case 'attack_error': case 'attack_blocked': case 'serve_error': return 'error';
    default: return null;
  }
}

export interface Tally { n: number; points: number; errors: number }
export const emptyTally = (): Tally => ({ n: 0, points: 0, errors: 0 });

export function tally(list: Pick<VEvent, 'action'>[]): Tally {
  const t = emptyTally();
  for (const e of list) {
    const r = result(e.action);
    if (!r) continue;
    t.n++;
    if (r === 'point') t.points++;
    if (r === 'error') t.errors++;
  }
  return t;
}

/** Attack efficiency (kills − errors) / attempts; the same formula for serves (aces − errors) / serves. */
export const eff = (t: Tally) => (t.n ? (t.points - t.errors) / t.n : null);
export const pointPct = (t: Tally) => (t.n ? t.points / t.n : null);
export const errorPct = (t: Tally) => (t.n ? t.errors / t.n : null);

/** Group events by a key and tally each group, in the order of [keys]. */
export function splitBy<K extends string>(list: VEvent[], key: (e: VEvent) => K | null, keys: K[]): Map<K, Tally> {
  const out = new Map<K, Tally>(keys.map((k) => [k, emptyTally()]));
  for (const e of list) {
    const k = key(e);
    if (k == null || !out.has(k)) continue;
    const t = out.get(k)!;
    const r = result(e.action);
    if (!r) continue;
    t.n++;
    if (r === 'point') t.points++;
    if (r === 'error') t.errors++;
  }
  return out;
}
