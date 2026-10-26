import { useRef, useState } from 'react';
import { COURT, type Pt } from '../lib/court';

/** Steps the slider and the arrows lock to (meters along the net). */
const STEP = 0.2;
const W = COURT.width;
const snap = (x: number, step = STEP) => Math.max(0, Math.min(W, Math.round(Math.round(x / step) * step * 100) / 100));
/** Our zone at the net for a spot along it (seen from behind our baseline: 4 left, 3 middle, 2 right). */
export const netZone = (x: number) => (x < 3 ? 4 : x < 6 ? 3 : 2);

/**
 * A spot along the net (a block): the dot starts on the net and is dragged along it,
 * or moved with the slider / arrows in 0.2 m steps. Drawn as the camera sees it
 * ([flip]: we play the far half, so left and right swap). Picks { x, y: net }.
 */
export function NetSpot({ initial, flip = false, onPick, label = '✓ Set here' }: { initial?: number | null; flip?: boolean; onPick: (p: Pt) => void; label?: string }) {
  const [x, setX] = useState(() => snap(initial ?? W / 2));
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef(false);
  // Court meters -> picture: mirrored when we play the far half.
  const sx = (m: number) => (flip ? W - m : m);
  const pad = 0.6;

  function fromPointer(clientX: number) {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const u = ((clientX - r.left) / r.width) * (W + 2 * pad) - pad;
    // Dragging is finer than the slider; the arrows and the slider lock to 0.2 m.
    setX(snap(flip ? W - u : u, 0.1));
  }
  const zoneAt = (m: number) => netZone(m);
  const leftLabel = flip ? 'Zone 2' : 'Zone 4', rightLabel = flip ? 'Zone 4' : 'Zone 2';

  return (
    <div className="net-spot">
      <svg ref={svg} viewBox={`${-pad} -1.6 ${W + 2 * pad} 3.2`} className="net-svg" role="slider" aria-valuemin={0} aria-valuemax={W} aria-valuenow={x}
        aria-label="Spot along the net" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') setX(snap(x + (flip ? STEP : -STEP))); if (e.key === 'ArrowRight') setX(snap(x + (flip ? -STEP : STEP))); }}
        onPointerDown={(e) => { drag.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); fromPointer(e.clientX); }}
        onPointerMove={(e) => { if (drag.current) fromPointer(e.clientX); }}
        onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}>
        {/* Zone bands 4 / 3 / 2, the net, tick marks every 0.5 m, antennas */}
        {[0, 3, 6].map((z0) => (
          <rect key={z0} x={Math.min(sx(z0), sx(z0 + 3))} y={-0.9} width={3} height={1.8} className={`net-band ${zoneAt(z0 + 0.1) === 3 ? 'mid' : ''}`} />
        ))}
        {/* A tick every 0.2 m, longer every metre */}
        {Array.from({ length: Math.round(W / STEP) + 1 }, (_, k) => (
          <line key={k} x1={sx(k * STEP)} x2={sx(k * STEP)} y1={k % 5 === 0 ? -0.45 : -0.2} y2={k % 5 === 0 ? 0.45 : 0.2} className={`net-tick ${k % 5 === 0 ? '' : 'minor'}`} />
        ))}
        <line x1={0} x2={W} y1={0} y2={0} className="net-line" />
        <line x1={0} x2={0} y1={-1.3} y2={1.3} className="net-antenna" />
        <line x1={W} x2={W} y1={-1.3} y2={1.3} className="net-antenna" />
        {[1.5, 4.5, 7.5].map((m) => <text key={m} x={sx(m)} y={1.35} className="net-zone">{netZone(m)}</text>)}
        <circle cx={sx(x)} cy={0} r={0.42} className="net-dot" />
      </svg>
      <div className="net-ends small muted"><span>{leftLabel}</span><span>{rightLabel}</span></div>
      <div className="net-controls">
        <button className="btn" onClick={() => setX(snap(x - (flip ? -STEP : STEP)))} aria-label="Move left">◀</button>
        <input type="range" min={0} max={W} step={STEP} value={flip ? W - x : x} onChange={(e) => setX(snap(flip ? W - Number(e.target.value) : Number(e.target.value)))} aria-label="Along the net" />
        <button className="btn" onClick={() => setX(snap(x + (flip ? -STEP : STEP)))} aria-label="Move right">▶</button>
      </div>
      <div className="net-readout small">Zone {netZone(x)} · {x.toFixed(1)} m from our left antenna</div>
      <button className="btn btn-primary wide" onClick={() => onPick({ x, y: COURT.net })}>{label}</button>
    </div>
  );
}
