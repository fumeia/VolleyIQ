import { useEffect, useRef, useState } from 'react';
import { COURT, FULL_VIEW, PASS_TARGET, type Pt } from '../lib/court';
import type { PlotPoint } from './CourtHalf';

export interface PlotPath { key: string | number; from: Pt; to: Pt; color: string; title?: string }

interface Props {
  onPick?: (p: Pt) => void;
  /** Markers for the event being entered: where the ball was played from and where it went. */
  from?: Pt | null;
  to?: Pt | null;
  points?: PlotPoint[];
  paths?: PlotPath[];
  /** Draw [points] as a density grid (1.5 m cells) instead of dots. */
  heat?: boolean;
  showTarget?: boolean;
  label?: string;
  /** Drawn on its side (our half left, net upright): half as tall. 'auto' = on phones held upright. */
  sideways?: boolean | 'auto';
  /** We play on the far half in the video: draw the court as the camera sees it (our half at the top, mirrored). */
  flip?: boolean;
  /** Plots only: show just this stretch of the court (meters from our baseline), e.g. [4, 21] for attacks. */
  yRange?: [number, number];
}

const W = FULL_VIEW.x1 - FULL_VIEW.x0;
const H = FULL_VIEW.y1 - FULL_VIEW.y0;
const CELL = 1.5;
const round = (n: number) => Math.round(n * 100) / 100;

/** The whole court with run-off, for tapping spots on either side and for plots. */
export function CourtFull({ onPick, from, to, points, paths, heat, showTarget, label, sideways: side, flip, yRange }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const portrait = usePortraitPhone();
  const sideways = side === 'auto' ? portrait : !!side;
  // Court meters -> drawing units. Upright: seen from behind our baseline, our half at the
  // bottom. Sideways: the same picture turned a quarter clockwise (our half left).
  const vx = (x: number) => x - FULL_VIEW.x0;
  const vy = (y: number) => FULL_VIEW.y1 - y;
  // rect/line in court meters, mapped for either orientation.
  const P = (x0: number, y0: number) => {
    // Our court frame -> what the camera shows (turned around when we play far).
    const x = flip ? COURT.width - x0 : x0, y = flip ? COURT.length - y0 : y0;
    return sideways ? { x: y - FULL_VIEW.y0, y: x - FULL_VIEW.x0 } : { x: vx(x), y: vy(y) };
  };
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    const a = P(x0, y0), b = P(x1, y1);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  };
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const a = P(x0, y0), b = P(x1, y1);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  };
  const VW = sideways ? H : W;
  const VH = sideways ? W : H;

  // Pick on click (not pointerup): the sheet closes when a spot is chosen, and a
  // pointerup handler would let the trailing click fall through to whatever is
  // rendered underneath (e.g. re-triggering the "Serve · #N" button).
  function pick(e: React.MouseEvent<SVGSVGElement>) {
    if (!onPick || !svg.current) return;
    const ctm = svg.current.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const u = Math.max(0, Math.min(VW, p.x)), v = Math.max(0, Math.min(VH, p.y));
    const x = (sideways ? v : u) + FULL_VIEW.x0;
    const y = sideways ? u + FULL_VIEW.y0 : FULL_VIEW.y1 - v;
    onPick(flip ? { x: round(COURT.width - x), y: round(COURT.length - y) } : { x: round(x), y: round(y) });
  }

  const cells = heat && points ? bins(points) : null;
  const max = cells ? Math.max(1, ...cells.values()) : 1;

  const net = seg(FULL_VIEW.x0 + 0.4, COURT.net, FULL_VIEW.x1 - 0.4, COURT.net);
  const label_ = (x: number, y: number) => P(x, y);
  return (
    <svg ref={svg} className={`court-svg court-full ${sideways ? 'sideways' : ''} ${onPick ? 'is-pickable' : ''}`} viewBox={yRange && !sideways && !onPick ? `0 ${vy(yRange[1])} ${VW} ${yRange[1] - yRange[0]}` : `0 0 ${VW} ${VH}`}
      onClick={pick} role={onPick ? 'button' : 'img'} aria-label={label ?? 'Court'}>
      <defs>
        <marker id="court-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="court-arrowhead" />
        </marker>
      </defs>
      <rect x={0} y={0} width={VW} height={VH} className="court-runoff" />
      <rect {...box(0, 0, COURT.width, COURT.length)} className="court-floor" />
      {[3, 6].map((x) => <line key={x} {...seg(x, 0, x, COURT.length)} className="court-grid" />)}
      {[6, 12].map((y) => <line key={y} {...seg(0, y, COURT.width, y)} className="court-attack" />)}
      <rect {...box(0, 0, COURT.width, COURT.length)} className="court-lines" />
      <line {...net} className="court-netline" />
      {sideways ? (
        <>
          <text x={label_(FULL_VIEW.x0, COURT.net).x + 0.2} y={0.6} className="court-side">NET</text>
          <text x={0.3} y={VH - 0.3} className="court-side">{flip ? 'THEM' : 'US'}</text>
          <text x={VW - 0.3} y={VH - 0.3} className="court-side end">{flip ? 'US' : 'THEM'}</text>
        </>
      ) : (
        <>
          <text x={W - 0.3} y={vy(COURT.net) - 0.25} className="court-side end">NET</text>
          <text x={0.3} y={vy(COURT.length) - 0.5} className="court-side">{flip ? 'US' : 'THEM'}</text>
          <text x={0.3} y={vy(0) + 1.1} className="court-side">{flip ? 'THEM' : 'US'}</text>
        </>
      )}
      {showTarget && <circle cx={P(PASS_TARGET.x, PASS_TARGET.y).x} cy={P(PASS_TARGET.x, PASS_TARGET.y).y} r={1.5} className="court-target" />}
      {cells && [...cells.entries()].map(([k, n]) => {
        const [c, r] = k.split(',').map(Number);
        const b = box(c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL);
        return (
          <g key={k}>
            <rect {...b} className="court-heat" style={{ opacity: 0.15 + 0.8 * (n / max) }} />
            <text x={b.x + b.width / 2} y={b.y + b.height / 2 + 0.17} className="court-heat-n">{n}</text>
          </g>
        );
      })}
      {paths?.map((p) => (
        <line key={p.key} {...seg(p.from.x, p.from.y, p.to.x, p.to.y)} stroke={p.color} className="court-path" markerEnd="url(#court-arrow)">
          {p.title && <title>{p.title}</title>}
        </line>
      ))}
      {!cells && points?.map((p) => (
        <circle key={p.key} cx={P(p.x, p.y).x} cy={P(p.x, p.y).y} r={0.28} fill={p.color} className="court-dot">
          {p.title && <title>{p.title}</title>}
        </circle>
      ))}
      {from && to && <line {...seg(from.x, from.y, to.x, to.y)} className="court-path court-path-edit" markerEnd="url(#court-arrow)" />}
      {from && <circle cx={P(from.x, from.y).x} cy={P(from.x, from.y).y} r={0.4} className="court-marker-from" />}
      {to && <circle cx={P(to.x, to.y).x} cy={P(to.x, to.y).y} r={0.4} className="court-marker" />}
    </svg>
  );
}

/** Counts per 1.5 m cell of the court, keyed "col,row". */
function bins(points: Pt[]) {
  const out = new Map<string, number>();
  for (const p of points) {
    if (p.x < 0 || p.x > COURT.width || p.y < 0 || p.y > COURT.length) continue;
    const k = `${Math.min(5, Math.floor(p.x / CELL))},${Math.min(11, Math.floor(p.y / CELL))}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** A phone (upright or sideways): a tall court would not fit next to the video. */
function usePortraitPhone() {
  // Upright phones (narrow) and phones held sideways (low panel next to the video).
  const q = '((orientation: portrait) and (max-width: 700px)), (max-height: 600px)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}
