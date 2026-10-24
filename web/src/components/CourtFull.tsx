import { useRef } from 'react';
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
}

const W = FULL_VIEW.x1 - FULL_VIEW.x0;
const H = FULL_VIEW.y1 - FULL_VIEW.y0;
const CELL = 1.5;
// Court meters -> drawing units: seen from behind our baseline, our half at the bottom.
const vx = (x: number) => x - FULL_VIEW.x0;
const vy = (y: number) => FULL_VIEW.y1 - y;
const round = (n: number) => Math.round(n * 100) / 100;

/** The whole court with run-off, for tapping spots on either side and for plots. */
export function CourtFull({ onPick, from, to, points, paths, heat, showTarget, label }: Props) {
  const svg = useRef<SVGSVGElement>(null);

  function pick(e: React.PointerEvent<SVGSVGElement>) {
    if (!onPick || !svg.current) return;
    const ctm = svg.current.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const x = Math.max(0, Math.min(W, p.x)) + FULL_VIEW.x0;
    const y = FULL_VIEW.y1 - Math.max(0, Math.min(H, p.y));
    onPick({ x: round(x), y: round(y) });
  }

  const cells = heat && points ? bins(points) : null;
  const max = cells ? Math.max(1, ...cells.values()) : 1;

  return (
    <svg ref={svg} className={`court-svg court-full ${onPick ? 'is-pickable' : ''}`} viewBox={`0 0 ${W} ${H}`}
      onPointerUp={pick} role={onPick ? 'button' : 'img'} aria-label={label ?? 'Court'}>
      <defs>
        <marker id="court-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="court-arrowhead" />
        </marker>
      </defs>
      <rect x={0} y={0} width={W} height={H} className="court-runoff" />
      <rect x={vx(0)} y={vy(COURT.length)} width={COURT.width} height={COURT.length} className="court-floor" />
      {[3, 6].map((x) => <line key={x} x1={vx(x)} x2={vx(x)} y1={vy(COURT.length)} y2={vy(0)} className="court-grid" />)}
      {[6, 12].map((y) => <line key={y} x1={vx(0)} x2={vx(9)} y1={vy(y)} y2={vy(y)} className="court-attack" />)}
      <rect x={vx(0)} y={vy(COURT.length)} width={COURT.width} height={COURT.length} className="court-lines" />
      <line x1={0.4} x2={W - 0.4} y1={vy(COURT.net)} y2={vy(COURT.net)} className="court-netline" />
      <text x={W - 0.3} y={vy(COURT.net) - 0.25} className="court-side end">NET</text>
      <text x={0.3} y={vy(COURT.length) - 0.5} className="court-side">THEM</text>
      <text x={0.3} y={vy(0) + 1.1} className="court-side">US</text>
      {showTarget && <circle cx={vx(PASS_TARGET.x)} cy={vy(PASS_TARGET.y)} r={1.5} className="court-target" />}
      {cells && [...cells.entries()].map(([k, n]) => {
        const [c, r] = k.split(',').map(Number);
        return (
          <g key={k}>
            <rect x={vx(c * CELL)} y={vy((r + 1) * CELL)} width={CELL} height={CELL} className="court-heat" style={{ opacity: 0.15 + 0.8 * (n / max) }} />
            <text x={vx(c * CELL) + CELL / 2} y={vy((r + 1) * CELL) + CELL / 2 + 0.17} className="court-heat-n">{n}</text>
          </g>
        );
      })}
      {paths?.map((p) => (
        <line key={p.key} x1={vx(p.from.x)} y1={vy(p.from.y)} x2={vx(p.to.x)} y2={vy(p.to.y)} stroke={p.color}
          className="court-path" markerEnd="url(#court-arrow)">
          {p.title && <title>{p.title}</title>}
        </line>
      ))}
      {!cells && points?.map((p) => (
        <circle key={p.key} cx={vx(p.x)} cy={vy(p.y)} r={0.28} fill={p.color} className="court-dot">
          {p.title && <title>{p.title}</title>}
        </circle>
      ))}
      {from && to && <line x1={vx(from.x)} y1={vy(from.y)} x2={vx(to.x)} y2={vy(to.y)} className="court-path court-path-edit" markerEnd="url(#court-arrow)" />}
      {from && <circle cx={vx(from.x)} cy={vy(from.y)} r={0.4} className="court-marker-from" />}
      {to && <circle cx={vx(to.x)} cy={vy(to.y)} r={0.4} className="court-marker" />}
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
