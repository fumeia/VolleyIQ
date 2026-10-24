/**
 * Court coordinates, in meters, as seen from behind our own baseline (the usual
 * camera spot): x runs 0..9 from left to right, y runs 0..18 from our baseline
 * (y = 0) over the net (y = 9) to the opponent's baseline (y = 18). Points
 * outside the court are allowed (out balls, shanked passes).
 */
export const COURT = { width: 9, length: 18, net: 9, attackLine: 3 };

export type Half = 'ours' | 'theirs';

export interface Pt { x: number; y: number }

export const inCourt = ({ x, y }: Pt) => x >= 0 && x <= 9 && y >= 0 && y <= 18;

/** Standard zone (1..6) of a point, numbered from the perspective of the team on that half. */
export function zoneOf({ x, y }: Pt): number | null {
  if (!inCourt({ x, y })) return null;
  if (y < COURT.net) {
    const col = x < 3 ? 0 : x < 6 ? 1 : 2; // our left .. our right
    return y >= COURT.net - COURT.attackLine ? [4, 3, 2][col] : [5, 6, 1][col];
  }
  // The opponent faces us, so their left is our right.
  const col = x >= 6 ? 0 : x >= 3 ? 1 : 2;
  return y <= COURT.net + COURT.attackLine ? [4, 3, 2][col] : [5, 6, 1][col];
}

/** Where a perfect pass goes: 1 m off the net, between zones 3 and 2. */
export const PASS_TARGET: Pt = { x: 6, y: 8 };

/** Receive grade 0..3 suggested from where the pass landed. */
export function receiveGrade(p: Pt): number {
  if (p.y > COURT.net) return 1;                       // overpass: the opponent gets a free ball
  if (p.x < -0.5 || p.x > 9.5 || p.y < -0.5) return 0; // shanked out of play
  const d = Math.hypot(p.x - PASS_TARGET.x, p.y - PASS_TARGET.y);
  if (d <= 1.5) return 3;
  if (d <= 3) return 2;
  return 1;
}

/** Visible area of a half drawing, including the run-off around the court. */
export const HALF_VIEW = { marginX: 2, behind: 3, overNet: 0.5 };
export const VIEW_W = COURT.width + 2 * HALF_VIEW.marginX;
export const VIEW_H = COURT.net + HALF_VIEW.behind + HALF_VIEW.overNet;

/** Court meters -> SVG units for a half drawing (net at the bottom for "theirs", at the top for "ours"). */
export function toView(half: Half, p: Pt): Pt {
  const x = p.x + HALF_VIEW.marginX;
  return half === 'theirs'
    ? { x, y: COURT.length + HALF_VIEW.behind - p.y }
    : { x, y: COURT.net + HALF_VIEW.overNet - p.y };
}

export function fromView(half: Half, v: Pt): Pt {
  const x = v.x - HALF_VIEW.marginX;
  const y = half === 'theirs' ? COURT.length + HALF_VIEW.behind - v.y : COURT.net + HALF_VIEW.overNet - v.y;
  return { x: round(x), y: round(y) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Event fields for tapped court spots: [from] = where the ball was played from (fx, fy),
 * [to] = where it went (x, y). The zone is where it went; a receive gets the grade its pass implies.
 */
export function courtFields(action: string, from: Pt | null, to: Pt | null) {
  const at = to ?? from;
  return {
    fx: from?.x ?? null, fy: from?.y ?? null,
    x: to?.x ?? null, y: to?.y ?? null,
    zone: at ? zoneOf(at) : null,
    ...(action === 'receive' && to ? { value: receiveGrade(to) } : {}),
  };
}

/** Visible area of the full-court drawing (meters): run-off beside and behind both baselines. */
export const FULL_VIEW = { x0: -2, x1: 11, y0: -3, y1: 21 };
