import { scoreOf, type ActionCode, type RoleCode } from './actions';
import type { Player, VEvent } from './api';

/** Roles that attack (not the setter, libero or defensive specialist). */
export const ATTACKER_ROLES: RoleCode[] = ['OH', 'OPP', 'MB'];

/**
 * Starting line-up of one set: order[0] is in position 1 (the server's spot), then
 * positions 2..6. With a libero, she replaces the middle blockers in the back row.
 */
export interface Lineup {
  order: (number | null)[];
  libero?: number | null;
  weServeFirst: boolean;
  /** Substitutions: from video time t on, [in] plays in [out]'s place. */
  subs?: Sub[];
}

export interface Sub { t: number; out: number; in: number }

/** The starting order with the substitutions made up to time [at] (Infinity = all of them). */
export function orderAt(lineup: Lineup, at = Infinity): (number | null)[] {
  let order = [...lineup.order];
  for (const s of [...(lineup.subs ?? [])].sort((a, b) => a.t - b.t)) {
    if (s.t > at) break;
    order = order.map((id) => (id === s.out ? s.in : id === s.in ? s.out : id));
  }
  return order;
}

/** Line-ups per set number ("1".."5"). */
export type Lineups = Record<string, Lineup>;

export interface RotationState {
  /** Player id per court position 1..6 (index 0 = position 1), after libero swaps. */
  positions: (number | null)[];
  /** Rotation count since the start of the set (0 = starting line-up). */
  turns: number;
  weServe: boolean;
}

export const FRONT = [2, 3, 4];

/**
 * Where everyone stands for the next rally: replays the points of the set so far.
 * We rotate when we win a point on their serve (side-out). [points]: who won each
 * rally, in order.
 */
export function rotationAfter(lineup: Lineup, points: ('us' | 'them')[], players: Player[], at = Infinity): RotationState {
  const order = orderAt(lineup, at);
  let weServe = lineup.weServeFirst;
  let turns = 0;
  for (const p of points) {
    if (p === 'us' && !weServe) turns++;
    weServe = p === 'us';
  }
  const base = Array.from({ length: 6 }, (_, i) => order[(i + turns) % 6] ?? null);
  const role = (id: number | null) => players.find((x) => x.id === id)?.role;
  const positions = base.map((id, i) => {
    const pos = i + 1;
    const back = !FRONT.includes(pos);
    // The libero takes the middle's place in the back row, but the middle serves from position 1.
    if (lineup.libero && back && role(id) === 'MB' && !(pos === 1 && weServe)) return lineup.libero;
    return id;
  });
  return { positions, turns, weServe };
}

/** Who won each rally of a set so far, from the point-ending events before time [before]. */
export function pointsOfSet(events: VEvent[], set: number, before: number): ('us' | 'them')[] {
  return events
    .filter((e) => e.status === 'confirmed' && (e.set_no ?? 1) === set && (e.t ?? 0) < before)
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
    .map((e) => scoreOf(e))
    .filter((s): s is 'us' | 'them' => !!s);
}

/**
 * Likely player for a touch, and who can make it at all. The server is the player in
 * position 1; the second touch is the setter's; blocks come from the front row.
 */
export function candidates(state: RotationState, action: ActionCode, players: Player[]): { likely: number | null; eligible: Set<number> } {
  const onCourt = state.positions.filter((x): x is number => x != null);
  const at = (pos: number[]) => pos.map((p) => state.positions[p - 1]).filter((x): x is number => x != null);
  const role = (id: number) => players.find((x) => x.id === id)?.role;
  const setter = onCourt.find((id) => role(id) === 'S') ?? null;
  const libero = onCourt.find((id) => role(id) === 'L');
  switch (action) {
    case 'serve': case 'ace': case 'serve_error': {
      const server = state.positions[0];
      return { likely: server, eligible: new Set(server != null ? [server] : onCourt) };
    }
    case 'set': case 'set_error':
      return { likely: setter, eligible: new Set(onCourt) };
    case 'assist': case 'assist_error': // bump set: someone other than the setter
      return { likely: null, eligible: new Set(onCourt.filter((id) => id !== setter)) };
    case 'block_touch': case 'block_point': case 'block_error': case 'block_miss':
      return { likely: null, eligible: new Set(at(FRONT)) };
    case 'attack': case 'kill': case 'attack_error': case 'attack_blocked': {
      // Only attackers (not the setter or libero); a libero in trouble plays a free ball instead.
      const attackers = onCourt.filter((id) => ATTACKER_ROLES.includes(role(id) as RoleCode));
      return { likely: null, eligible: new Set(attackers.length ? attackers : onCourt.filter((id) => id !== libero)) };
    }
    default:
      return { likely: null, eligible: new Set(onCourt) };
  }
}

/**
 * Suggestion by player role when there is no line-up for the set (so the rotation
 * is unknown): the setter sets, only attackers attack/block. Works from roles alone.
 */
export function roleCandidates(action: ActionCode, players: Player[]): { likely: number | null; eligible: Set<number> } {
  const active = players.filter((p) => p.active);
  const all = new Set(active.map((p) => p.id));
  const byRole = (roles: RoleCode[]) => active.filter((p) => roles.includes(p.role)).map((p) => p.id);
  const setter = active.find((p) => p.role === 'S')?.id ?? null;
  switch (action) {
    case 'set': case 'set_error':
      return { likely: setter, eligible: all };
    case 'assist': case 'assist_error':
      return { likely: null, eligible: new Set(active.filter((p) => p.id !== setter).map((p) => p.id)) };
    case 'attack': case 'kill': case 'attack_error': case 'attack_blocked': {
      const att = byRole(ATTACKER_ROLES);
      return { likely: null, eligible: att.length ? new Set(att) : all };
    }
    case 'block_touch': case 'block_point': case 'block_error': case 'block_miss': {
      const bl = byRole(ATTACKER_ROLES);
      return { likely: null, eligible: bl.length ? new Set(bl) : all };
    }
    default:
      return { likely: null, eligible: all };
  }
}

/** Rotation-based suggestion when a line-up exists, else role-based. */
export function suggest(action: ActionCode, players: Player[], rotation: RotationState | null): { likely: number | null; eligible: Set<number> } {
  return rotation ? candidates(rotation, action, players) : roleCandidates(action, players);
}
