import type { ReactNode } from 'react';
import { HALF_VIEW, PASS_TARGET, toView, VIEW_H, VIEW_W, COURT, type Half } from '../lib/court';

/**
 * Drawing primitives for the shareable report cards. Cards are plain SVG with
 * inline attributes only (no CSS classes), so the exact same markup can be
 * rasterised to a PNG for chats. Colors follow the dataviz reference palette,
 * light mode (white paper), validated: outcome slots blue/orange/aqua (all-pairs CVD-safe, plus
 * shape as second channel) and a one-hue blue ordinal ramp for pass grades.
 */
export const W = 1080;
export const H = 1350;
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const C = {
  page: '#f3f2ee',
  surface: '#ffffff',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#6f6d68',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  brand: '#f97316',
  // categorical (light steps): identity of series / outcome classes
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  // ordinal ramp for receive grades 0..3 (one hue, light -> dark: the better, the darker)
  grade: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab'],
  court: '#f3ead9',
  courtLine: '#8f8a80',
};

export type Outcome = 'point' | 'play' | 'error';
export const OUTCOME_COLOR: Record<Outcome, string> = { point: C.aqua, play: C.blue, error: C.orange };

export function Card({ kind, title, subtitle, footer, children }: { kind: string; title: string; subtitle?: string; footer?: string; children: ReactNode }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} fontFamily={FONT}>
      <rect width={W} height={H} fill={C.page} />
      <rect x={24} y={24} width={W - 48} height={H - 48} rx={36} fill={C.surface} />
      <circle cx={84} cy={92} r={14} fill={C.brand} />
      <text x={110} y={102} fill={C.ink2} fontSize={28} fontWeight={600}>VolleyIQ</text>
      <text x={W - 72} y={102} fill={C.muted} fontSize={24} fontWeight={600} textAnchor="end" letterSpacing={3}>{kind.toUpperCase()}</text>
      {/* Long titles shrink before they get cut */}
      <text x={72} y={182} fill={C.ink} fontSize={title.length > 34 ? 40 : title.length > 26 ? 46 : 54} fontWeight={800}>{clip(title, 40)}</text>
      {subtitle && <text x={72} y={228} fill={C.ink2} fontSize={28}>{clip(subtitle, 56)}</text>}
      {children}
      {footer && <text x={W / 2} y={H - 52} fill={C.muted} fontSize={22} textAnchor="middle">{footer}</text>}
    </svg>
  );
}

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function Heading({ x, y, children }: { x: number; y: number; children: string }) {
  return <text x={x} y={y} fill={C.muted} fontSize={24} fontWeight={700} letterSpacing={2.5}>{children.toUpperCase()}</text>;
}

/** Stat tile: label, big value, optional detail line. */
export function Tile({ x, y, w, h = 150, label, value, sub }: { x: number; y: number; w: number; h?: number; label: string; value: string; sub?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={20} fill={C.page} />
      <text x={x + 24} y={y + 42} fill={C.muted} fontSize={22} fontWeight={600} letterSpacing={1.5}>{label.toUpperCase()}</text>
      <text x={x + 24} y={y + 100} fill={C.ink} fontSize={52} fontWeight={800}>{value}</text>
      {sub && <text x={x + 24} y={y + 134} fill={C.ink2} fontSize={22}>{clip(sub, Math.floor(w / 12))}</text>}
    </g>
  );
}

/** Horizontal bars of one series: label, bar with a rounded data end, value. */
export function HBars({ x, y, w, rows, color, rowH = 64 }: { x: number; y: number; w: number; rows: { label: string; value: number }[]; color: string; rowH?: number }) {
  const labelW = 330;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const barW = w - labelW - 80;
  return (
    <g>
      {rows.map((r, i) => {
        const len = Math.max(r.value > 0 ? 10 : 0, (r.value / max) * barW);
        const cy = y + i * rowH + rowH / 2;
        return (
          <g key={r.label}>
            <title>{`${r.label}: ${r.value}`}</title>
            <text x={x} y={cy + 9} fill={C.ink2} fontSize={28}>{r.label}</text>
            <line x1={x + labelW} x2={x + labelW} y1={cy - 22} y2={cy + 22} stroke={C.axis} strokeWidth={2} />
            {len > 0 && <rect x={x + labelW} y={cy - 16} width={len} height={32} rx={8} fill={color} />}
            <text x={x + labelW + len + 16} y={cy + 10} fill={C.ink} fontSize={30} fontWeight={700}>{r.value}</text>
          </g>
        );
      })}
    </g>
  );
}

export interface CourtDot { x: number; y: number; outcome?: Outcome; grade?: number; title?: string }

/** Marks: point = filled dot, in play = ring, error = cross (shape carries the class too). */
export function Mark({ cx, cy, dot, s = 1 }: { cx: number; cy: number; dot: CourtDot; s?: number }) {
  if (dot.grade != null) {
    return <circle cx={cx} cy={cy} r={12 * s} fill={C.grade[dot.grade]} stroke={C.surface} strokeWidth={3 * s}><title>{dot.title}</title></circle>;
  }
  const color = OUTCOME_COLOR[dot.outcome ?? 'play'];
  if (dot.outcome === 'error') {
    const k = 10 * s;
    return (
      <g stroke={color} strokeWidth={5 * s} strokeLinecap="round">
        <title>{dot.title}</title>
        <line x1={cx - k} y1={cy - k} x2={cx + k} y2={cy + k} />
        <line x1={cx - k} y1={cy + k} x2={cx + k} y2={cy - k} />
      </g>
    );
  }
  if (dot.outcome === 'play') {
    return <circle cx={cx} cy={cy} r={10 * s} fill="none" stroke={color} strokeWidth={5 * s}><title>{dot.title}</title></circle>;
  }
  return <circle cx={cx} cy={cy} r={13 * s} fill={color} stroke={C.surface} strokeWidth={3 * s}><title>{dot.title}</title></circle>;
}

/** Half court (as seen from behind our baseline) at (x, y), `scale` px per meter. */
export function CourtSvg({ x, y, scale, half, dots, target, zoneLabels }: {
  x: number; y: number; scale: number; half: Half; dots: CourtDot[]; target?: boolean; zoneLabels?: boolean;
}) {
  const v = (p: { x: number; y: number }) => {
    const q = toView(half, p);
    return { x: x + q.x * scale, y: y + q.y * scale };
  };
  const a = v({ x: 0, y: half === 'theirs' ? COURT.length : 0 });
  const net = v({ x: 0, y: COURT.net });
  const top = Math.min(a.y, net.y);
  const left = x + HALF_VIEW.marginX * scale;
  const att = v({ x: 0, y: half === 'theirs' ? COURT.net + COURT.attackLine : COURT.net - COURT.attackLine });
  const t = target ? v(PASS_TARGET) : null;
  const zones = half === 'theirs'
    ? [[4, 7.5, 10.5], [3, 4.5, 10.5], [2, 1.5, 10.5], [5, 7.5, 15], [6, 4.5, 15], [1, 1.5, 15]]
    : [[4, 1.5, 7.5], [3, 4.5, 7.5], [2, 7.5, 7.5], [5, 1.5, 3], [6, 4.5, 3], [1, 7.5, 3]];
  return (
    <g>
      <rect x={x} y={y} width={VIEW_W * scale} height={VIEW_H * scale} rx={16} fill={C.page} />
      <rect x={left} y={top} width={COURT.width * scale} height={COURT.net * scale} fill={C.court} />
      {[3, 6].map((m) => <line key={m} x1={left + m * scale} x2={left + m * scale} y1={top} y2={top + COURT.net * scale} stroke={C.axis} strokeWidth={2} />)}
      <line x1={left} x2={left + COURT.width * scale} y1={att.y} y2={att.y} stroke={C.courtLine} strokeWidth={2} />
      <rect x={left} y={top} width={COURT.width * scale} height={COURT.net * scale} fill="none" stroke={C.courtLine} strokeWidth={3} />
      <line x1={x + 12} x2={x + VIEW_W * scale - 12} y1={net.y} y2={net.y} stroke={C.ink2} strokeWidth={5} />
      <text x={x + VIEW_W * scale - 18} y={net.y + (half === 'theirs' ? -10 : 26)} fill={C.muted} fontSize={18} textAnchor="end" letterSpacing={3}>NET</text>
      {zoneLabels && zones.map(([z, zx, zy]) => {
        const p = v({ x: zx, y: zy });
        return <text key={z} x={p.x} y={p.y + 12} fill={C.axis} fontSize={34} fontWeight={800} textAnchor="middle">{z}</text>;
      })}
      {t && <circle cx={t.x} cy={t.y} r={1.5 * scale} fill="none" stroke={C.grade[3]} strokeWidth={2} />}
      {dots.map((d, i) => {
        const p = v(d);
        return <Mark key={i} cx={p.x} cy={p.y} dot={d} s={scale / 64} />;
      })}
    </g>
  );
}

export function OutcomeLegend({ x, y, labels }: { x: number; y: number; labels: [string, string, string] }) {
  const items: [Outcome, string][] = [['point', labels[0]], ['play', labels[1]], ['error', labels[2]]];
  return (
    <g>
      {items.map(([o, l], i) => (
        <g key={o} transform={`translate(${x + i * 260},${y})`}>
          <Mark cx={14} cy={-9} dot={{ x: 0, y: 0, outcome: o }} />
          <text x={40} y={0} fill={C.ink2} fontSize={26}>{l}</text>
        </g>
      ))}
    </g>
  );
}

export function GradeLegend({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <text x={x} y={y} fill={C.ink2} fontSize={24}>Pass grade</text>
      {[0, 1, 2, 3].map((g) => (
        <g key={g} transform={`translate(${x + 150 + g * 90},${y})`}>
          <rect x={0} y={-22} width={30} height={30} rx={6} fill={C.grade[g]} />
          <text x={40} y={0} fill={C.ink2} fontSize={24}>{g}</text>
        </g>
      ))}
    </g>
  );
}

export const fmtEff = (v: number | null) => (v == null ? '–' : (v < 0 ? '-' : '') + Math.abs(v).toFixed(3).replace(/^0/, ''));
export const fmtPct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
export const fmtAvg = (v: number | null) => (v == null ? '–' : v.toFixed(2));
