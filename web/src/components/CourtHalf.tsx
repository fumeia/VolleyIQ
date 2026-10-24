import { useRef } from 'react';
import { COURT, fromView, HALF_VIEW, PASS_TARGET, toView, VIEW_H, VIEW_W, type Half, type Pt } from '../lib/court';

export interface PlotPoint extends Pt { color: string; key: string | number; title?: string }

interface Props {
  half: Half;
  onPick?: (p: Pt) => void;
  points?: PlotPoint[];
  marker?: Pt | null;
  showTarget?: boolean;
  label?: string;
  /** Draw the points as a density grid (1.5 m cells) instead of dots. */
  heat?: boolean;
}

const CELL = 1.5;

/** Counts per 1.5 m cell of the half, keyed "col,row" in court meters. */
function bins(half: Half, points: Pt[]) {
  const out = new Map<string, number>();
  for (const p of points) {
    const inHalf = half === 'theirs' ? p.y >= COURT.net && p.y <= COURT.length : p.y >= 0 && p.y <= COURT.net;
    if (!inHalf || p.x < 0 || p.x > COURT.width) continue;
    const c = Math.min(5, Math.floor(p.x / CELL));
    const r = Math.min(11, Math.floor(p.y / CELL));
    out.set(`${c},${r}`, (out.get(`${c},${r}`) ?? 0) + 1);
  }
  return out;
}

/**
 * One half of the court plus run-off, drawn as seen from behind our baseline.
 * "theirs" has the net at the bottom (where our attacks and serves land),
 * "ours" has the net at the top (where receives land).
 */
export function CourtHalf({ half, onPick, points, marker, showTarget, label, heat }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const corner = (p: Pt) => toView(half, p);
  const nearBase = corner({ x: 0, y: half === 'theirs' ? COURT.length : 0 });
  const netLeft = corner({ x: 0, y: COURT.net });
  const attack = corner({ x: 0, y: half === 'theirs' ? COURT.net + COURT.attackLine : COURT.net - COURT.attackLine });
  const top = Math.min(nearBase.y, netLeft.y);
  const x0 = HALF_VIEW.marginX;

  function pick(e: React.PointerEvent<SVGSVGElement>) {
    if (!onPick || !svg.current) return;
    const ctm = svg.current.getScreenCTM();
    if (!ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    onPick(fromView(half, { x: Math.max(0, Math.min(VIEW_W, pt.x)), y: Math.max(0, Math.min(VIEW_H, pt.y)) }));
  }

  const target = showTarget ? corner(PASS_TARGET) : null;
  const m = marker ? corner(marker) : null;

  return (
    <svg
      ref={svg}
      className={`court-svg ${onPick ? 'is-pickable' : ''}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      onPointerUp={pick}
      role={onPick ? 'button' : 'img'}
      aria-label={label ?? `${half === 'theirs' ? 'Opponent' : 'Our'} court`}
    >
      <rect x={0} y={0} width={VIEW_W} height={VIEW_H} className="court-runoff" />
      <rect x={x0} y={top} width={COURT.width} height={COURT.net} className="court-floor" />
      {/* zone grid */}
      {[3, 6].map((x) => (
        <line key={x} x1={x0 + x} x2={x0 + x} y1={top} y2={top + COURT.net} className="court-grid" />
      ))}
      <line x1={x0} x2={x0 + COURT.width} y1={attack.y} y2={attack.y} className="court-attack" />
      <rect x={x0} y={top} width={COURT.width} height={COURT.net} className="court-lines" />
      <line x1={0.6} x2={VIEW_W - 0.6} y1={netLeft.y} y2={netLeft.y} className="court-netline" />
      <text x={VIEW_W / 2} y={netLeft.y + (half === 'theirs' ? 0.42 : -0.15)} className="court-nettext">NET</text>
      {target && <circle cx={target.x} cy={target.y} r={1.5} className="court-target" />}
      {heat && points && (() => {
        const b = bins(half, points);
        const max = Math.max(1, ...b.values());
        return [...b.entries()].map(([k, n]) => {
          const [c, r] = k.split(',').map(Number);
          const a = corner({ x: c * CELL, y: r * CELL });
          const z = corner({ x: (c + 1) * CELL, y: (r + 1) * CELL });
          const y = Math.min(a.y, z.y);
          return (
            <g key={k}>
              <rect x={a.x} y={y} width={CELL} height={CELL} className="court-heat" style={{ opacity: 0.15 + 0.8 * (n / max) }} />
              <text x={a.x + CELL / 2} y={y + CELL / 2 + 0.17} className="court-heat-n">{n}</text>
            </g>
          );
        });
      })()}
      {!heat && points?.map((p) => {
        const v = corner(p);
        return (
          <circle key={p.key} cx={v.x} cy={v.y} r={0.28} fill={p.color} className="court-dot">
            {p.title && <title>{p.title}</title>}
          </circle>
        );
      })}
      {m && <circle cx={m.x} cy={m.y} r={0.4} className="court-marker" />}
    </svg>
  );
}
