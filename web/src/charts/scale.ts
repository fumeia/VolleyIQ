/** Linear scale: maps [d0, d1] onto [r0, r1]. */
export function linear(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** "Nice" tick values covering [lo, hi] (1, 2, 2.5 or 5 times a power of ten), about [count] of them. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0];
  if (lo === hi) { hi = lo + 1; }
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step + 1e-9) * step;
  const out: number[] = [];
  // Up to the first tick at or above hi, so the axis covers every value.
  for (let i = 0; out.length < 2 || out[out.length - 1] < hi - step * 1e-9; i++) out.push(Math.round((start + i * step) / step) * step);
  return out.map((v) => Math.round(v * 1e9) / 1e9);
}

/** Tick label without float noise: 0.30000000000000004 -> "0.3". */
export const tickLabel = (v: number, fmt?: (v: number) => string) => (fmt ? fmt(v) : String(Math.round(v * 1000) / 1000));
