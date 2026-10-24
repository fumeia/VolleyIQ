/**
 * Court calibration from any 4+ known court points (not just the corners,
 * which are often outside the frame). Court frame as the camera sees it:
 * x 0..9 left to right, y 0 at the near baseline, 9 at the net, 18 far baseline.
 */
export interface Landmark { id: string; label: string; x: number; y: number }

// Ordered by how often they are visible from a camera behind the near baseline.
export const LANDMARKS: Landmark[] = [
  { id: 'netL', label: 'Centre line × left sideline (under the net)', x: 0, y: 9 },
  { id: 'netR', label: 'Centre line × right sideline (under the net)', x: 9, y: 9 },
  { id: 'attNL', label: 'Near 3 m line × left sideline', x: 0, y: 6 },
  { id: 'attNR', label: 'Near 3 m line × right sideline', x: 9, y: 6 },
  { id: 'nearL', label: 'Near baseline × left sideline (corner)', x: 0, y: 0 },
  { id: 'nearR', label: 'Near baseline × right sideline (corner)', x: 9, y: 0 },
  { id: 'attFL', label: 'Far 3 m line × left sideline', x: 0, y: 12 },
  { id: 'attFR', label: 'Far 3 m line × right sideline', x: 9, y: 12 },
  { id: 'farL', label: 'Far baseline × left sideline (corner)', x: 0, y: 18 },
  { id: 'farR', label: 'Far baseline × right sideline (corner)', x: 9, y: 18 },
];

/** One tapped landmark: image position (0..1 of the video picture) and its court position (m). */
export interface CalPoint { id: string; u: number; v: number; x: number; y: number }

export interface Calibration { points: CalPoint[]; ourHalf: 'near' | 'far'; corners?: [number, number][] }

type H = number[]; // 3x3 row-major, h[8] = 1

/** Least-squares homography from src to dst (>= 4 pairs). Null when the points are degenerate. */
export function solveHomography(src: { x: number; y: number }[], dst: { x: number; y: number }[]): H | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  // Normal equations (A^T A) h = A^T b for the 8 unknowns.
  const ata = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const atb = new Array(8).fill(0);
  const add = (row: number[], b: number) => {
    for (let i = 0; i < 8; i++) {
      atb[i] += row[i] * b;
      for (let j = 0; j < 8; j++) ata[i][j] += row[i] * row[j];
    }
  };
  src.forEach((s, k) => {
    const d = dst[k];
    add([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x], d.x);
    add([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y], d.y);
  });
  const h = gauss(ata, atb);
  return h ? [...h, 1] : null;
}

function gauss(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

export function apply(h: H, p: { x: number; y: number }) {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/**
 * Checks a set of tapped points: enough of them, not (nearly) on one line, and the fitted
 * mapping reproduces every tap. Returns the court -> image mapping for drawing the overlay.
 */
export function evaluate(points: CalPoint[]): { ok: boolean; reason?: string; courtToImage?: H; maxError?: number } {
  if (points.length < 4) return { ok: false, reason: `Mark ${4 - points.length} more point${points.length === 3 ? '' : 's'}` };
  const xs = new Set(points.map((p) => p.x));
  const ys = new Set(points.map((p) => p.y));
  if (xs.size < 2 || ys.size < 2) return { ok: false, reason: 'Use points on both sidelines and on two different lines across the court' };
  const h = solveHomography(points.map((p) => ({ x: p.x, y: p.y })), points.map((p) => ({ x: p.u, y: p.v })));
  if (!h) return { ok: false, reason: 'These points do not define the court; try others' };
  const maxError = Math.max(...points.map((p) => {
    const q = apply(h, p);
    return Math.hypot(q.x - p.u, q.y - p.v);
  }));
  // With exactly 4 points the fit is exact; with more, a big residual means a mislabelled tap.
  if (maxError > 0.03) return { ok: false, reason: 'The points do not agree. Check that each tap matches the selected landmark', courtToImage: h, maxError };
  return { ok: true, courtToImage: h, maxError };
}

/** Court lines (meters) drawn on the video to check the fit. */
export const COURT_LINES: [number, number, number, number][] = [
  [0, 0, 9, 0], [0, 18, 9, 18], [0, 0, 0, 18], [9, 0, 9, 18], // outline
  [0, 9, 9, 9], // centre line
  [0, 6, 9, 6], [0, 12, 9, 12], // attack lines
];

/** Calibration points as flat [u, v, x, y, ...] for the native analysis. Old 4-corner calibrations still work. */
export function flatPoints(c: Calibration): number[] {
  if (c.points?.length) return c.points.flatMap((p) => [p.u, p.v, p.x, p.y]);
  const court = [[0, 0], [9, 0], [9, 18], [0, 18]];
  return (c.corners ?? []).flatMap(([u, v], i) => [u, v, court[i][0], court[i][1]]);
}
