import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { linear, niceTicks, tickLabel } from './scale';

/**
 * Small SVG chart kit for the analysis pages: real axes (ticks, titles), hairline
 * grids, thin marks, a legend for two or more series, hover tooltips and a table
 * view for every chart. Charts sit on white paper (see .chart in styles.css); the
 * light-surface palette is validated with the dataviz checks.
 */
export const SERIES = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a' };
/** Ordinal blue ramp (light -> dark), e.g. pass grades 0..3: the better, the darker. */
export const RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'];

const INK = 'var(--text)';
const MUTED = 'var(--muted)';
const GRID = '#e1e0d9';
const AXIS = '#9a988f';
const FONT = 11;

export interface Table { head: string[]; rows: (string | number | null)[][] }
export interface Key { name: string; color: string }

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(340);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(260, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export interface Tip { x: number; y: number; lines: string[] }

/** Figure: title, subtitle, legend, the plot, a hover tooltip, and a table toggle. */
export function Frame({ title, subtitle, legend, table, children, tip, wrap }: {
  title: string; subtitle?: string; legend?: Key[]; table: Table; children: ReactNode; tip: Tip | null;
  wrap: React.RefObject<HTMLDivElement | null>;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption>
        <div className="chart-title">
          <b>{title}</b>
          <button className="chart-toggle" onClick={() => setAsTable(!asTable)}>{asTable ? 'Chart' : 'Table'}</button>
        </div>
        {subtitle && <span className="chart-sub">{subtitle}</span>}
        {legend && legend.length > 1 && !asTable && (
          <span className="chart-legend">{legend.map((k) => <span key={k.name}><i style={{ background: k.color }} />{k.name}</span>)}</span>
        )}
      </figcaption>
      <div className="chart-plot" ref={wrap}>
        {asTable ? (
          <div className="table-wrap">
            <table className="stat-table">
              <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c ?? '–'}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : children}
        {tip && !asTable && (
          <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>{tip.lines.map((l, i) => <div key={i}>{l}</div>)}</div>
        )}
      </div>
    </figure>
  );
}

/** Horizontal bar ending in a 4px rounded data-end, square at the baseline. */
function hbar(x0: number, x1: number, y: number, h: number) {
  const r = Math.min(4, Math.abs(x1 - x0), h / 2);
  if (x1 >= x0) return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
  return `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
}

/** Column with a 4px rounded top. */
function vbar(x: number, w: number, y0: number, y1: number) {
  const r = Math.min(4, Math.abs(y0 - y1), w / 2);
  return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
}

/** Left margin that fits the longest row label (12px text), at most 40% of the width. */
function labelColumn(labels: string[], w: number) {
  const longest = Math.max(4, ...labels.map((l) => l.length));
  return Math.min(Math.round(w * 0.4), 14 + longest * 6.6);
}
const fit = (label: string, room: number) => {
  const n = Math.max(4, Math.floor((room - 14) / 6.6));
  return label.length > n ? label.slice(0, n - 1) + '…' : label;
};

function YAxisTitle({ x, y, text }: { x: number; y: number; text: string }) {
  return <text transform={`translate(${x},${y}) rotate(-90)`} textAnchor="middle" fill={MUTED} fontSize={FONT}>{text}</text>;
}

/* ------------------------------------------------------------------ line */

/** End-of-line values, moved apart just enough (12px) not to overlap. */
function endLabels(labels: { x: number; y: number; text: string }[]) {
  const out = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < 12) out[i] = { ...out[i], y: out[i - 1].y + 12 };
  return out;
}

export interface LineSeries { name: string; color: string; points: { x: number; y: number }[] }

export function LineChart({ title, subtitle, series, xTitle, yTitle, yFmt, xFmt, step, yDomain, height = 220, refLine, categorical }: {
  title: string; subtitle?: string; series: LineSeries[]; xTitle: string; yTitle: string;
  yFmt?: (v: number) => string; xFmt?: (v: number) => string; step?: boolean; yDomain?: [number, number]; height?: number;
  /** A horizontal reference line (e.g. 0, or the season average). */
  refLine?: { y: number; label: string };
  /** x values are categories 1..n (e.g. matches): one tick each, half a step of room at both ends. */
  categorical?: boolean;
}) {
  const [wrap, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  const m = { l: 44, r: 40, t: 10, b: 36 };
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const cats = [...new Set(xs)].sort((a, b) => a - b);
  const xTicks = categorical ? cats : niceTicks(Math.min(0, ...xs), Math.max(1, ...xs), Math.max(2, Math.floor((w - m.l - m.r) / 60)));
  const yTicks = niceTicks(yDomain?.[0] ?? Math.min(0, ...ys), yDomain?.[1] ?? Math.max(1, ...ys), 4);
  const [x0, x1] = categorical ? [Math.min(...cats) - 0.5, Math.max(...cats) + 0.5] : [xTicks[0], xTicks[xTicks.length - 1]];
  const X = linear(x0, x1, m.l, w - m.r);
  // Few points: mark each one (a single value would otherwise be invisible).
  const markAll = !step && Math.max(0, ...series.map((s) => s.points.length)) <= 24;
  const Y = linear(yTicks[0], yTicks[yTicks.length - 1], height - m.b, m.t);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => {
    if (i === 0) return `M${X(p.x)},${Y(p.y)}`;
    return step ? `H${X(p.x)}V${Y(p.y)}` : `L${X(p.x)},${Y(p.y)}`;
  }).join('');
  const at = (s: LineSeries, x: number) => [...s.points].reverse().find((p) => p.x <= x);
  const table: Table = {
    head: [xTitle, ...series.map((s) => s.name)],
    rows: [...new Set(xs)].sort((a, b) => a - b).map((x) => [xFmt ? xFmt(x) : x, ...series.map((s) => {
      const p = at(s, x);
      return p ? (yFmt ? yFmt(p.y) : p.y) : null;
    })]),
  };

  function move(e: React.PointerEvent<SVGRectElement>) {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - box.left;
    const xv = x0 + ((px - m.l) / (w - m.l - m.r)) * (x1 - x0);
    const near = [...new Set(xs)].sort((a, b) => Math.abs(a - xv) - Math.abs(b - xv))[0];
    if (near == null) return;
    setHoverX(near);
    setTip({
      x: Math.min(X(near) + 8, w - 140), y: m.t,
      lines: [`${xTitle} ${xFmt ? xFmt(near) : near}`, ...series.map((s) => { const p = at(s, near); return `${s.name}: ${p ? (yFmt ? yFmt(p.y) : p.y) : '–'}`; })],
    });
  }

  return (
    <Frame title={title} subtitle={subtitle} legend={series.map((s) => ({ name: s.name, color: s.color }))} table={table} tip={tip} wrap={wrap}>
      <svg width={w} height={height} role="img" aria-label={title}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? AXIS : GRID} />
            <text x={m.l - 6} y={Y(t) + 4} textAnchor="end" fill={MUTED} fontSize={FONT} className="tnum">{tickLabel(t, yFmt)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={X(t)} y={height - m.b + 15} textAnchor="middle" fill={MUTED} fontSize={FONT} className="tnum">{tickLabel(t, xFmt)}</text>
        ))}
        <line x1={m.l} x2={w - m.r} y1={height - m.b} y2={height - m.b} stroke={AXIS} />
        <text x={(m.l + w - m.r) / 2} y={height - 4} textAnchor="middle" fill={MUTED} fontSize={FONT}>{xTitle}</text>
        <YAxisTitle x={11} y={(m.t + height - m.b) / 2} text={yTitle} />
        {refLine && (
          <g>
            <line x1={m.l} x2={w - m.r} y1={Y(refLine.y)} y2={Y(refLine.y)} stroke={MUTED} strokeDasharray="0" strokeOpacity={0.5} />
            <text x={w - m.r + 3} y={Y(refLine.y) + 4} fill={MUTED} fontSize={10}>{refLine.label}</text>
          </g>
        )}
        {hoverX != null && <line x1={X(hoverX)} x2={X(hoverX)} y1={m.t} y2={height - m.b} stroke={MUTED} strokeOpacity={0.6} />}
        {series.map((s) => s.points.length > 0 && (
          <g key={s.name}>
            <path d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {markAll && s.points.slice(0, -1).map((p) => <circle key={p.x} cx={X(p.x)} cy={Y(p.y)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
            {(() => {
              const p = s.points[s.points.length - 1];
              return <circle cx={X(p.x)} cy={Y(p.y)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
            })()}
          </g>
        ))}
        {endLabels(series.filter((s) => s.points.length).map((s) => {
          const p = s.points[s.points.length - 1];
          return { x: X(p.x) + 7, y: Y(p.y) + 4, text: yFmt ? yFmt(p.y) : String(p.y) };
        })).map((l, i) => <text key={i} x={l.x} y={l.y} fill={INK} fontSize={FONT} fontWeight={700} className="tnum">{l.text}</text>)}
        <rect x={m.l} y={m.t} width={w - m.l - m.r} height={height - m.t - m.b} fill="transparent"
          onPointerMove={move} onPointerLeave={() => { setTip(null); setHoverX(null); }} />
      </svg>
    </Frame>
  );
}

/* ------------------------------------------------------------- bars */

export interface BarRow { label: string; value: number | null; note?: string }

/** Horizontal bars from a common baseline (negative values go left of zero). */
export function BarChart({ title, subtitle, rows, valueTitle, fmt, color = SERIES.blue, colorOf, domain }: {
  title: string; subtitle?: string; rows: BarRow[]; valueTitle: string; fmt?: (v: number) => string; color?: string;
  /** Per-bar colour, e.g. green above zero and red below (the side of zero carries the sign too). */
  colorOf?: (v: number) => string;
  domain?: [number, number];
}) {
  const [wrap, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const shown = rows.filter((r) => r.value != null) as (BarRow & { value: number })[];
  const rowH = 28, barH = 14;
  const m = { l: labelColumn(rows.map((r) => r.label), w), r: Math.min(140, 46 + 6 * Math.max(0, ...rows.map((r) => (r.note ? r.note.length + 3 : 0)))), t: 6, b: 36 };
  const height = m.t + m.b + Math.max(1, shown.length) * rowH;
  const vals = shown.map((r) => r.value);
  const ticks = niceTicks(domain?.[0] ?? Math.min(0, ...vals), domain?.[1] ?? Math.max(0.0001, ...vals), Math.max(2, Math.floor((w - m.l - m.r) / 70)));
  const X = linear(ticks[0], ticks[ticks.length - 1], m.l, w - m.r);
  const f = (v: number) => (fmt ? fmt(v) : tickLabel(v));
  return (
    <Frame title={title} subtitle={subtitle} table={{ head: ['', valueTitle, ''], rows: rows.map((r) => [r.label, r.value == null ? null : f(r.value), r.note ?? '']) }} tip={tip} wrap={wrap}>
      {shown.length === 0 ? <p className="muted small">No data yet.</p> : (
        <svg width={w} height={height} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={m.t} y2={height - m.b} stroke={t === 0 ? AXIS : GRID} />
              <text x={X(t)} y={height - m.b + 15} textAnchor="middle" fill={MUTED} fontSize={FONT} className="tnum">{tickLabel(t, fmt)}</text>
            </g>
          ))}
          <text x={(m.l + w - m.r) / 2} y={height - 4} textAnchor="middle" fill={MUTED} fontSize={FONT}>{valueTitle}</text>
          {shown.map((r, i) => {
            const y = m.t + i * rowH + (rowH - barH) / 2;
            const x0 = X(Math.max(ticks[0], 0)), x1 = X(r.value);
            return (
              <g key={r.label} onPointerEnter={() => setTip({ x: Math.min(x1, w - 150), y: y + barH + 4, lines: [r.label, `${valueTitle}: ${f(r.value)}`, ...(r.note ? [r.note] : [])] })}
                onPointerLeave={() => setTip(null)}>
                <rect x={0} y={m.t + i * rowH} width={w} height={rowH} fill="transparent" />
                <text x={m.l - 8} y={y + barH - 3} textAnchor="end" fill={INK} fontSize={12}>{fit(r.label, m.l)}</text>
                <path d={hbar(x0, x1, y, barH)} fill={colorOf ? colorOf(r.value) : color} />
                <text x={r.value >= 0 ? x1 + 5 : x0 + 5} y={y + barH - 3} fill={MUTED} fontSize={FONT} className="tnum">{f(r.value)}{r.note ? ` · ${r.note}` : ''}</text>
              </g>
            );
          })}
        </svg>
      )}
    </Frame>
  );
}

/* ------------------------------------------------------- stacked 100% */

export interface StackRow { label: string; parts: number[] }

/** 100% stacked horizontal bars (share of each part per row), with the count at the end. */
export function StackedBars({ title, subtitle, rows, keys, axisTitle = 'Share' }: { title: string; subtitle?: string; rows: StackRow[]; keys: Key[]; axisTitle?: string }) {
  const [wrap, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const rowH = 28, barH = 16;
  const m = { l: labelColumn(rows.map((r) => r.label), w), r: 36, t: 6, b: 36 };
  const height = m.t + m.b + Math.max(1, rows.length) * rowH;
  const X = linear(0, 1, m.l, w - m.r);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Frame title={title} subtitle={subtitle} legend={keys} tip={tip} wrap={wrap}
      table={{ head: ['', ...keys.map((k) => k.name), 'n'], rows: rows.map((r) => [r.label, ...r.parts, r.parts.reduce((a, b) => a + b, 0)]) }}>
      {rows.length === 0 ? <p className="muted small">No data yet.</p> : (
        <svg width={w} height={height} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={m.t} y2={height - m.b} stroke={t === 0 ? AXIS : GRID} />
              <text x={X(t)} y={height - m.b + 15} textAnchor="middle" fill={MUTED} fontSize={FONT} className="tnum">{pct(t)}</text>
            </g>
          ))}
          <text x={(m.l + w - m.r) / 2} y={height - 4} textAnchor="middle" fill={MUTED} fontSize={FONT}>{axisTitle}</text>
          {rows.map((r, i) => {
            const n = r.parts.reduce((a, b) => a + b, 0);
            const y = m.t + i * rowH + (rowH - barH) / 2;
            let acc = 0;
            return (
              <g key={r.label}>
                <text x={m.l - 8} y={y + barH - 4} textAnchor="end" fill={INK} fontSize={12}>{fit(r.label, m.l)}</text>
                {n > 0 && r.parts.map((p, k) => {
                  if (!p) return null;
                  const x0 = X(acc / n), x1 = X((acc + p) / n);
                  acc += p;
                  // 2px surface gap between segments.
                  return (
                    <rect key={k} x={x0 + (x0 > m.l ? 1 : 0)} y={y} width={Math.max(1, x1 - x0 - (x0 > m.l ? 1 : 0) - (x1 < w - m.r ? 1 : 0))} height={barH}
                      fill={keys[k].color} rx={1}
                      onPointerEnter={() => setTip({ x: Math.min(x0, w - 150), y: y + barH + 4, lines: [r.label, `${keys[k].name}: ${p} (${pct(p / n)})`] })}
                      onPointerLeave={() => setTip(null)} />
                  );
                })}
                <text x={w - m.r + 5} y={y + barH - 4} fill={MUTED} fontSize={FONT} className="tnum">{n}</text>
              </g>
            );
          })}
        </svg>
      )}
    </Frame>
  );
}

/* ---------------------------------------------------- grouped columns */

export function GroupedColumns({ title, subtitle, categories, series, yTitle, fmt, yDomain }: {
  title: string; subtitle?: string; categories: string[]; series: { name: string; color: string; values: (number | null)[]; notes?: string[] }[];
  yTitle: string; fmt?: (v: number) => string; yDomain?: [number, number];
}) {
  const [wrap, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const height = 220;
  const m = { l: 44, r: 10, t: 16, b: 36 };
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const ticks = niceTicks(yDomain?.[0] ?? 0, yDomain?.[1] ?? Math.max(0.0001, ...vals), 4);
  const Y = linear(ticks[0], ticks[ticks.length - 1], height - m.b, m.t);
  const band = (w - m.l - m.r) / Math.max(1, categories.length);
  const colW = Math.min(20, (band - 10) / series.length - 2);
  const f = (v: number) => (fmt ? fmt(v) : tickLabel(v));
  // Values on top of the columns when there is room (few series, wide enough columns).
  const labels = series.length <= 2 && colW >= 14;
  const fitC = (label: string, room: number) => {
    const n = Math.max(4, Math.floor(room / 6.2));
    return label.length > n ? label.slice(0, n - 1) + '…' : label;
  };
  return (
    <Frame title={title} subtitle={subtitle} legend={series.map((s) => ({ name: s.name, color: s.color }))} tip={tip} wrap={wrap}
      table={{ head: ['', ...series.map((s) => s.name)], rows: categories.map((c, i) => [c, ...series.map((s) => (s.values[i] == null ? null : f(s.values[i]!) + (s.notes?.[i] ? ` (${s.notes[i]})` : '')))]) }}>
      <svg width={w} height={height} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? AXIS : GRID} />
            <text x={m.l - 6} y={Y(t) + 4} textAnchor="end" fill={MUTED} fontSize={FONT} className="tnum">{tickLabel(t, fmt)}</text>
          </g>
        ))}
        <YAxisTitle x={11} y={(m.t + height - m.b) / 2} text={yTitle} />
        {categories.map((c, i) => {
          const cx = m.l + band * i + band / 2;
          const x0 = cx - (series.length * (colW + 2)) / 2;
          return (
            <g key={c}>
              <text x={cx} y={height - m.b + 15} textAnchor="middle" fill={INK} fontSize={FONT}>{fitC(c, band)}</text>
              {series.map((s, k) => {
                const v = s.values[i];
                if (v == null) return null;
                const x = x0 + k * (colW + 2);
                return (
                  <g key={s.name}>
                    <path d={vbar(x, colW, Y(Math.max(ticks[0], 0)), Y(v))} fill={s.color}
                      onPointerEnter={() => setTip({ x: Math.min(x, w - 150), y: Y(v) - 4, lines: [c, `${s.name}: ${f(v)}${s.notes?.[i] ? ` (${s.notes[i]})` : ''}`] })}
                      onPointerLeave={() => setTip(null)} />
                    {labels && <text x={x + colW / 2} y={Y(v) - 4} textAnchor="middle" fill={MUTED} fontSize={10} className="tnum">{f(v)}</text>}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </Frame>
  );
}

/* ------------------------------------------------------------ scatter */

/** Players on the same spot share one dot and one label ("#9 #14"). */
function mergeSame(points: { x: number; y: number; label: string; name: string }[]) {
  const by = new Map<string, { x: number; y: number; label: string; name: string }>();
  for (const p of points) {
    const k = `${p.x}|${p.y}`;
    const cur = by.get(k);
    by.set(k, cur ? { ...cur, label: `${cur.label} ${p.label}`, name: `${cur.name}, ${p.name}` } : { ...p });
  }
  return [...by.values()];
}

export function Scatter({ title, subtitle, points, xTitle, yTitle, xFmt, yFmt }: {
  title: string; subtitle?: string; points: { x: number; y: number; label: string; name: string }[];
  xTitle: string; yTitle: string; xFmt?: (v: number) => string; yFmt?: (v: number) => string;
}) {
  const [wrap, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const height = 250;
  const m = { l: 48, r: 24, t: 22, b: 38 };
  const xt = niceTicks(Math.min(0, ...points.map((p) => p.x)), Math.max(1, ...points.map((p) => p.x)), 5);
  const yt = niceTicks(Math.min(0, ...points.map((p) => p.y)), Math.max(0.1, ...points.map((p) => p.y)), 4);
  const X = linear(xt[0], xt[xt.length - 1], m.l, w - m.r);
  const Y = linear(yt[0], yt[yt.length - 1], height - m.b, m.t);
  return (
    <Frame title={title} subtitle={subtitle} tip={tip} wrap={wrap}
      table={{ head: ['', xTitle, yTitle], rows: points.map((p) => [p.name, xFmt ? xFmt(p.x) : p.x, yFmt ? yFmt(p.y) : p.y]) }}>
      {points.length === 0 ? <p className="muted small">No data yet.</p> : (
        <svg width={w} height={height} role="img" aria-label={title}>
          {yt.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? AXIS : GRID} />
              <text x={m.l - 6} y={Y(t) + 4} textAnchor="end" fill={MUTED} fontSize={FONT} className="tnum">{tickLabel(t, yFmt)}</text>
            </g>
          ))}
          {xt.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={m.t} y2={height - m.b} stroke={GRID} />
              <text x={X(t)} y={height - m.b + 15} textAnchor="middle" fill={MUTED} fontSize={FONT} className="tnum">{tickLabel(t, xFmt)}</text>
            </g>
          ))}
          <line x1={m.l} x2={w - m.r} y1={height - m.b} y2={height - m.b} stroke={AXIS} />
          <text x={(m.l + w - m.r) / 2} y={height - 4} textAnchor="middle" fill={MUTED} fontSize={FONT}>{xTitle}</text>
          <YAxisTitle x={11} y={(m.t + height - m.b) / 2} text={yTitle} />
          {mergeSame(points).map((p) => (
            <g key={p.name} onPointerEnter={() => setTip({ x: Math.min(X(p.x) + 8, w - 150), y: Y(p.y) - 8, lines: [p.name, `${xTitle}: ${xFmt ? xFmt(p.x) : p.x}`, `${yTitle}: ${yFmt ? yFmt(p.y) : p.y}`] })}
              onPointerLeave={() => setTip(null)}>
              <circle cx={X(p.x)} cy={Y(p.y)} r={10} fill="transparent" />
              <circle cx={X(p.x)} cy={Y(p.y)} r={5} fill={SERIES.blue} stroke="var(--surface)" strokeWidth={2} />
              <text x={X(p.x) + 8} y={Y(p.y) - 6} fill={INK} fontSize={FONT}>{p.label}</text>
            </g>
          ))}
        </svg>
      )}
    </Frame>
  );
}
