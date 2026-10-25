import type { Player } from './api';
import { SERVES, type Rally } from './sequence';

/**
 * Rotations from the serve tags alone, no line-up needed: whoever serves for us is
 * in position 1, and the order our players serve in is the rotation order. Each
 * rally is in the rotation of our most recent server (we only rotate on a
 * side-out, and then the next player serves). Rallies before our first serve of
 * a set belong to the rotation before it, known once all six have served.
 *
 * Rotations are named by the setter's position (S1..S6, the usual 5-1 naming) when
 * the setter is in the serve order, otherwise by the server ("#5 serving"). A
 * substitute who serves takes the rotation of the player they replaced.
 */

export interface RotationRally { rally: Rally; server: number | null; label: string | null }

const serverOf = (r: Rally) => (r.weServed && SERVES.includes(r.touches[0]?.action) ? r.touches[0].player_id : null);

/** Our serve order in one set, by first serve (up to six players). */
function serveOrder(rallies: Rally[]): number[] {
  const order: number[] = [];
  for (const r of rallies) {
    const s = serverOf(r);
    if (s != null && !order.includes(s) && order.length < 6) order.push(s);
  }
  return order;
}

export function inferRotations(rallies: Rally[], players: Player[]): RotationRally[] {
  const out: RotationRally[] = [];
  const bySet = new Map<string, Rally[]>();
  for (const r of rallies) {
    const k = `${r.match}:${r.set}`;
    const list = bySet.get(k);
    if (list) list.push(r); else bySet.set(k, [r]);
  }
  const roleOf = new Map(players.map((p) => [p.id, p.role]));
  for (const list of bySet.values()) {
    const order = serveOrder(list);
    const setterIdx = order.findIndex((id) => roleOf.get(id) === 'S');
    const named = setterIdx >= 0 && order.length === 6;
    // Slot j: order[j] serves from position 1, so order[j+k] stands in position k+1 (players
    // rotate 2 -> 1 on each side-out, so the next server is the one in position 2).
    const slotLabel = (j: number) => `S${((setterIdx - j + 6) % 6) + 1}`;
    const serverLabel = (server: number) => `#${players.find((x) => x.id === server)?.number ?? '?'} serving`;
    // Before our first serve: the rotation of the player before the first server in the order.
    let slot: number | null = order.length === 6 ? 5 : null;
    let current: number | null = slot == null ? null : order[slot];
    for (const r of list) {
      const s = serverOf(r);
      if (s != null && s !== current) {
        // A new serve turn. A substitute serving (not in the order) stands in the slot after
        // the previous turn, so the rotation stays the team's, not the player's.
        const j = order.indexOf(s);
        slot = j >= 0 ? j : slot == null ? null : (slot + 1) % 6;
        current = s;
      }
      const label = current == null ? null : named && slot != null ? slotLabel(slot) : serverLabel(current);
      out.push({ rally: r, server: current, label });
    }
  }
  return out;
}

export interface RotationRow { label: string; received: number; sideouts: number; served: number; breaks: number }

/** Side-out and break-point counts per rotation, in S1..S6 (or server) order. */
export function rotationTable(rows: RotationRally[]): RotationRow[] {
  const map = new Map<string, RotationRow>();
  for (const { rally, label } of rows) {
    if (!label || rally.won == null || rally.weServed == null) continue;
    const t = map.get(label) ?? { label, received: 0, sideouts: 0, served: 0, breaks: 0 };
    if (rally.weServed) { t.served++; if (rally.won) t.breaks++; } else { t.received++; if (rally.won) t.sideouts++; }
    map.set(label, t);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
