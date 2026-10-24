import { useMemo, useRef, useState } from 'react';
import { apply, COURT_LINES, evaluate, LANDMARKS, type CalPoint, type Calibration } from '../lib/calibration';

/** State of one calibration session, shared by the video overlay and the control panel. */
export function useCalibration(initial?: Calibration | null) {
  const [points, setPoints] = useState<CalPoint[]>(() => initial?.points ?? []);
  const [active, setActive] = useState<string>(() => nextFree(initial?.points ?? []) ?? LANDMARKS[0].id);
  const result = useMemo(() => evaluate(points), [points]);

  function place(u: number, v: number) {
    const l = LANDMARKS.find((x) => x.id === active)!;
    const next = [...points.filter((p) => p.id !== active), { id: active, u: round(u), v: round(v), x: l.x, y: l.y }];
    setPoints(next);
    const free = nextFree(next);
    if (free) setActive(free);
  }

  return {
    points, active, setActive, result, place,
    undo: () => setPoints(points.slice(0, -1)),
    reset: () => { setPoints([]); setActive(LANDMARKS[0].id); },
  };
}

export type CalibrationSession = ReturnType<typeof useCalibration>;

const nextFree = (pts: CalPoint[]) => LANDMARKS.find((l) => !pts.some((p) => p.id === l.id))?.id;
const round = (n: number) => Math.round(n * 10000) / 10000;

/** Transparent layer over the (paused) video: tap = place the selected landmark; shows the fitted court. */
export function CalibrationOverlay({ session, aspect }: { session: CalibrationSession; aspect: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  // The video is letterboxed inside the box (object-fit: contain).
  function rect() {
    const r = box.current!.getBoundingClientRect();
    const w = Math.min(r.width, r.height * aspect);
    const h = w / aspect;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, w, h, ox: (r.width - w) / 2, oy: (r.height - h) / 2 };
  }

  function tap(e: React.PointerEvent) {
    const c = rect();
    session.place((e.clientX - c.left) / c.w, (e.clientY - c.top) / c.h);
    force((n) => n + 1);
  }

  const c = box.current ? rect() : null;
  const px = (u: number, v: number) => (c ? [c.ox + u * c.w, c.oy + v * c.h] : [0, 0]);
  const h = session.result.courtToImage;

  return (
    <div className="calib" ref={box} onPointerUp={tap}>
      <svg className="calib-svg">
        {h && COURT_LINES.map(([x1, y1, x2, y2], i) => {
          // Draw each line in short pieces so perspective stays right even far outside the frame.
          const pts = Array.from({ length: 21 }, (_, k) => apply(h, { x: x1 + ((x2 - x1) * k) / 20, y: y1 + ((y2 - y1) * k) / 20 }));
          return <polyline key={i} points={pts.map((p) => px(p.x, p.y).join(',')).join(' ')}
            className={session.result.ok ? 'calib-line ok' : 'calib-line'} />;
        })}
        {session.points.map((p) => {
          const [x, y] = px(p.u, p.v);
          const n = LANDMARKS.findIndex((l) => l.id === p.id) + 1;
          return <g key={p.id}><circle cx={x} cy={y} r={8} className="calib-dot" /><text x={x + 11} y={y - 9} className="calib-label">{n}</text></g>;
        })}
      </svg>
    </div>
  );
}

/** Controls below the video: pick which landmark to mark on a mini court, then save. */
export function CalibrationPanel({ session, onSave, onCancel }: {
  session: CalibrationSession; onSave: (c: Calibration) => void; onCancel: () => void;
}) {
  const active = LANDMARKS.find((l) => l.id === session.active)!;
  const s = 13; // px per meter in the diagram
  const pos = (l: { x: number; y: number }) => ({ cx: 14 + l.x * s, cy: 10 + (18 - l.y) * s });
  return (
    <div className="calib-panel">
      <svg className="calib-mini" viewBox={`0 0 ${9 * s + 28} ${18 * s + 34}`} role="img" aria-label="Court landmarks">
        <rect x={14} y={10} width={9 * s} height={18 * s} className="mini-court" />
        {[6, 9, 12].map((y) => <line key={y} x1={14} x2={14 + 9 * s} y1={10 + (18 - y) * s} y2={10 + (18 - y) * s} className={y === 9 ? 'mini-net' : 'mini-line'} />)}
        {LANDMARKS.map((l, i) => {
          const placed = session.points.some((p) => p.id === l.id);
          return (
            <g key={l.id} onClick={() => session.setActive(l.id)} className="mini-landmark">
              <circle {...pos(l)} r={9} className={`${placed ? 'placed' : ''} ${l.id === session.active ? 'active' : ''}`} />
              <text x={pos(l).cx} y={pos(l).cy + 4} textAnchor="middle">{i + 1}</text>
            </g>
          );
        })}
        <text x={14 + 4.5 * s} y={10 + 18 * s + 26} textAnchor="middle" className="mini-cam">camera side</text>
      </svg>
      <div className="calib-side">
        <span className="small muted">Tap a numbered point on the mini court, then tap the same spot on the video. Any 4+ points work; corners are optional.</span>
        <b className="small">Now marking {LANDMARKS.indexOf(active) + 1}: {active.label}</b>
        <span className={`small ${session.result.ok ? 'ok-text' : 'muted'}`}>
          {session.result.ok ? `✓ Court fits (${session.points.length} points). Check the green lines, then choose your half:` : session.result.reason}
        </span>
        <div className="row wrap">
          {session.result.ok && (
            <>
              <button className="btn btn-primary" onClick={() => onSave({ points: session.points, ourHalf: 'near' })}>We play near</button>
              <button className="btn" onClick={() => onSave({ points: session.points, ourHalf: 'far' })}>We play far</button>
            </>
          )}
          {session.points.length > 0 && <button className="btn-ghost small" onClick={session.undo}>Undo</button>}
          {session.points.length > 0 && <button className="btn-ghost small" onClick={session.reset}>Clear</button>}
          <button className="btn-ghost small" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
