import type { ReactNode } from 'react';
import { COURT, zoneOf } from '../../lib/court';

/* ------------------------------------------------------------ formats */

export const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
export const eff3 = (v: number | null | undefined) => (v == null ? '–' : v.toFixed(3).replace(/^(-?)0\./, '$1.'));
export const avg2 = (v: number | null | undefined, d = 2) => (v == null ? '–' : v.toFixed(d));
export const meters = (v: number | null | undefined) => (v == null ? '–' : `${v.toFixed(1)} m`);
export const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
/** "1 ace", "3 aces". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* -------------------------------------------------------------- tones */

export type Tone = 'good' | 'bad' | null;

/**
 * When a number is good (green ▲) or a problem (red ▼) for a club team. Thresholds
 * are rules of thumb for amateur/club volleyball; efficiencies simply by their sign.
 */
export const judge = {
  /** (points − errors) / attempts: plus is good, minus is bad. */
  eff: (v: number | null): Tone => (v == null ? null : v > 0 ? 'good' : v < 0 ? 'bad' : null),
  killPct: (v: number | null): Tone => (v == null ? null : v >= 0.4 ? 'good' : v < 0.25 ? 'bad' : null),
  /** Share of attempts that were errors. */
  errPct: (v: number | null): Tone => (v == null ? null : v <= 0.1 ? 'good' : v >= 0.2 ? 'bad' : null),
  serveErrPct: (v: number | null): Tone => (v == null ? null : v <= 0.1 ? 'good' : v >= 0.2 ? 'bad' : null),
  acePct: (v: number | null): Tone => (v == null ? null : v >= 0.1 ? 'good' : null),
  passAvg: (v: number | null): Tone => (v == null ? null : v >= 2.1 ? 'good' : v < 1.6 ? 'bad' : null),
  perfectPct: (v: number | null): Tone => (v == null ? null : v >= 0.4 ? 'good' : v < 0.2 ? 'bad' : null),
  /** Distance of passes/digs from the target. */
  distance: (v: number | null): Tone => (v == null ? null : v <= 1.8 ? 'good' : v > 2.8 ? 'bad' : null),
  plusMinus: (v: number | null): Tone => (v == null ? null : v > 0 ? 'good' : v < 0 ? 'bad' : null),
  sideout: (v: number | null): Tone => (v == null ? null : v >= 0.6 ? 'good' : v < 0.45 ? 'bad' : null),
  break: (v: number | null): Tone => (v == null ? null : v >= 0.4 ? 'good' : v < 0.3 ? 'bad' : null),
  /** Share of possessions turned into a kill (transition). */
  conversion: (v: number | null): Tone => (v == null ? null : v >= 0.35 ? 'good' : v < 0.2 ? 'bad' : null),
  /** Win % (rallies). */
  win: (v: number | null): Tone => (v == null ? null : v >= 0.55 ? 'good' : v < 0.45 ? 'bad' : null),
  /** A count of errors: any error is worth a look, many is bad. */
  errors: (n: number, of: number): Tone => (of < 5 ? null : n / of >= 0.2 ? 'bad' : null),
};

/** A value with its tone: green ▲ when good, red ▼ when bad (the arrow keeps it readable without colour). */
export function Val({ tone, children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`val ${tone ? `tone-${tone}` : ''}`} title={title}>
      {tone === 'good' && <i aria-label="good">▲</i>}
      {tone === 'bad' && <i aria-label="needs work">▼</i>}
      {children}
    </span>
  );
}

/** Small sample: shown muted, and never toned (too few to judge). */
export const enough = (n: number, min = 5) => n >= min;

/* -------------------------------------------------------------- table */

export interface Cell { text: ReactNode; tone?: Tone; title?: string }
export interface Column<R> { h: string; title?: string; cell: (r: R) => Cell | string | number }

/** A figure with a table of numbers, on the same white paper as the charts. */
export function StatFigure<R>({ title, subtitle, columns, rows, rowKey, first, note }: {
  title: string; subtitle?: string; columns: Column<R>[]; rows: R[]; rowKey: (r: R) => string | number;
  first: Column<R>; note?: string;
}) {
  return (
    <figure className="chart stat-figure">
      <figcaption>
        <div className="chart-title"><b>{title}</b></div>
        {subtitle && <span className="chart-sub">{subtitle}</span>}
      </figcaption>
      {rows.length === 0 ? <p className="muted small">No data yet.</p> : (
        <div className="table-wrap">
          <table className="stat-table">
            <thead><tr><th>{first.h}</th>{columns.map((c) => <th key={c.h} title={c.title}>{c.h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={rowKey(r)}>
                  <td>{render(first.cell(r))}</td>
                  {columns.map((c) => <td key={c.h}>{render(c.cell(r))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="chart-note-inline">{note}</p>}
    </figure>
  );
}

function render(c: Cell | string | number) {
  if (typeof c !== 'object' || c == null) return c;
  return c.tone ? <Val tone={c.tone} title={c.title}>{c.text}</Val> : <span title={c.title}>{c.text}</span>;
}

/* ------------------------------------------------------------- colours */

const GRAY = [240, 239, 236]; // diverging midpoint (light)
const BLUE = [42, 120, 214];  // better
const RED = [227, 73, 72];    // worse
const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

/**
 * Diverging fill for a value around a neutral point: blue = better, red = worse,
 * grey = neutral (validated colour-blind safe, unlike green/red fills).
 */
export function diverge(v: number | null, neutral: number, spread: number, higherIsBetter = true) {
  if (v == null) return '#f4f3ef';
  let t = (v - neutral) / spread;
  if (!higherIsBetter) t = -t;
  t = Math.max(-1, Math.min(1, t));
  return t >= 0 ? mix(GRAY, BLUE, t) : mix(GRAY, RED, -t);
}

/** One-hue fill for a count/share (light blue → dark blue). */
export function sequential(t: number) {
  return mix([236, 243, 252], [28, 92, 171], Math.max(0, Math.min(1, t)));
}

/** Readable text on a fill. */
export const inkOn = (fill: string) => {
  const m = fill.match(/\d+/g);
  if (!m) return '#0b0b0b';
  const [r, g, b] = m.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b < 140 ? '#ffffff' : '#0b0b0b';
};

/* --------------------------------------------------------- court zones */

export interface ZoneValue { fill: string; main: string; sub?: string; title?: string }

/**
 * A half court split into the six zones, as seen from behind our baseline: the
 * opponent's half with the net at the bottom, or ours with the net at the top.
 */
export function HalfZones({ title, subtitle, half, values, legend, note }: {
  title: string; subtitle?: string; half: 'ours' | 'theirs'; values: Map<number, ZoneValue>;
  legend?: ReactNode; note?: string;
}) {
  const m = 0.6; // margin around the court (m)
  const W = COURT.width + 2 * m, H = COURT.net + 2 * m + 0.7;
  // Court meters -> drawing: x as seen from behind our baseline; theirs = net at the bottom.
  const Y = (y: number) => (half === 'theirs' ? m + (COURT.length - y) : m + 0.6 + (COURT.net - y));
  const cells: { zone: number; x: number; y: number; w: number; h: number }[] = [];
  for (const col of [0, 1, 2]) {
    for (const row of [0, 1]) {
      // Our half: back row y 0..6, front 6..9; theirs: front 9..12, back 12..18.
      const y0 = half === 'ours' ? (row === 0 ? 0 : COURT.net - COURT.attackLine) : (row === 0 ? COURT.net : COURT.net + COURT.attackLine);
      const y1 = half === 'ours' ? (row === 0 ? COURT.net - COURT.attackLine : COURT.net) : (row === 0 ? COURT.net + COURT.attackLine : COURT.length);
      const zone = zoneOf({ x: col * 3 + 1.5, y: (y0 + y1) / 2 })!;
      const top = Math.min(Y(y0), Y(y1));
      cells.push({ zone, x: m + col * 3, y: top, w: 3, h: Math.abs(Y(y1) - Y(y0)) });
    }
  }
  const netY = half === 'theirs' ? Y(COURT.net) : Y(COURT.net);
  return (
    <figure className="chart zone-figure">
      <figcaption>
        <div className="chart-title"><b>{title}</b></div>
        {subtitle && <span className="chart-sub">{subtitle}</span>}
        {legend && <span className="chart-legend">{legend}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="zone-svg" role="img" aria-label={title}>
        {cells.map((c) => {
          const v = values.get(c.zone);
          const fill = v?.fill ?? '#f4f3ef';
          const ink = inkOn(fill);
          return (
            <g key={c.zone}>
              <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={fill} stroke="#ffffff" strokeWidth={0.08}>
                {v?.title && <title>{v.title}</title>}
              </rect>
              <text x={c.x + 0.18} y={c.y + 0.5} fontSize={0.36} fill={ink} opacity={0.75}>Z{c.zone}</text>
              <text x={c.x + c.w / 2} y={c.y + c.h / 2 + 0.1} fontSize={0.78} fontWeight={700} textAnchor="middle" fill={ink}>{v?.main ?? '–'}</text>
              {v?.sub && <text x={c.x + c.w / 2} y={c.y + c.h / 2 + 0.72} fontSize={0.38} textAnchor="middle" fill={ink} opacity={0.85}>{v.sub}</text>}
            </g>
          );
        })}
        <rect x={m} y={Math.min(...cells.map((c) => c.y))} width={COURT.width} height={Math.max(...cells.map((c) => c.y + c.h)) - Math.min(...cells.map((c) => c.y))}
          fill="none" stroke="#52514e" strokeWidth={0.06} />
        <line x1={m - 0.4} x2={m + COURT.width + 0.4} y1={netY} y2={netY} stroke="#f97316" strokeWidth={0.12} strokeDasharray="0.3 0.18" />
        <text x={m + COURT.width / 2} y={half === 'theirs' ? netY + 0.45 : netY - 0.2} fontSize={0.34} textAnchor="middle" fill="#5f5e5a">NET</text>
        <text x={m} y={half === 'theirs' ? 0.42 : H - 0.12} fontSize={0.34} fill="#5f5e5a">{half === 'theirs' ? 'OPPONENT' : 'US'}</text>
      </svg>
      {note && <p className="chart-note-inline">{note}</p>}
    </figure>
  );
}

/** Legend chip for a fill. */
export const Swatch = ({ fill, label }: { fill: string; label: string }) => (
  <span><i style={{ background: fill }} />{label}</span>
);
