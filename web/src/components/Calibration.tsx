import { useRef, useState } from 'react';

type Corner = [number, number];

const STEPS = [
  'Tap the court corner nearest the camera on the LEFT',
  'Tap the near corner on the RIGHT',
  'Tap the far corner on the RIGHT',
  'Tap the far corner on the LEFT',
];

interface Props {
  aspect: number;                 // video width / height
  onSave: (corners: Corner[], ourHalf: 'near' | 'far') => void;
  onCancel: () => void;
}

/**
 * One-time court calibration on a paused frame: tap the 4 court corners. The
 * phone can then place players on the court, which tells our touches from the
 * opponent's even without jersey numbers.
 */
export function Calibration({ aspect, onSave, onCancel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<Corner[]>([]);

  // The video is letterboxed inside the box (object-fit: contain).
  function contentRect() {
    const r = box.current!.getBoundingClientRect();
    const w = Math.min(r.width, r.height * aspect);
    const h = w / aspect;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, w, h, boxLeft: r.left, boxTop: r.top };
  }

  function tap(e: React.PointerEvent) {
    if (pts.length >= 4) return;
    const c = contentRect();
    const u = (e.clientX - c.left) / c.w;
    const v = (e.clientY - c.top) / c.h;
    if (u < -0.2 || u > 1.2 || v < -0.2 || v > 1.2) return;
    setPts([...pts, [round(u), round(v)]]);
  }

  const c = box.current ? contentRect() : null;
  const toBox = ([u, v]: Corner) => (c ? [c.left - c.boxLeft + u * c.w, c.top - c.boxTop + v * c.h] : [0, 0]);

  return (
    <div className="calib" ref={box} onPointerUp={tap}>
      <svg className="calib-svg">
        {pts.length > 1 && (
          <polygon points={pts.map((p) => toBox(p).join(',')).join(' ')} className={pts.length === 4 ? 'calib-poly done' : 'calib-poly'} />
        )}
        {pts.map((p, i) => {
          const [x, y] = toBox(p);
          return <g key={i}><circle cx={x} cy={y} r={9} className="calib-dot" /><text x={x + 12} y={y - 10} className="calib-label">{i + 1}</text></g>;
        })}
      </svg>
      <div className="calib-bar" onPointerUp={(e) => e.stopPropagation()}>
        {pts.length < 4 ? (
          <>
            <span>{pts.length + 1}/4 · {STEPS[pts.length]}</span>
            <span className="row">
              {pts.length > 0 && <button className="btn-ghost small" onClick={() => setPts(pts.slice(0, -1))}>Undo</button>}
              <button className="btn-ghost small" onClick={onCancel}>Cancel</button>
            </span>
          </>
        ) : (
          <>
            <span>Which half does your team play on?</span>
            <span className="row">
              <button className="btn btn-primary" onClick={() => onSave(pts, 'near')}>Near (camera side)</button>
              <button className="btn" onClick={() => onSave(pts, 'far')}>Far</button>
              <button className="btn-ghost small" onClick={() => setPts([])}>Redo</button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10000) / 10000;
