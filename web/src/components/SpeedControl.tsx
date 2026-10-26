import { useEffect, useRef, useState } from 'react';
import type { PlayerHandle } from './VideoPlayer';

/** Playback speeds; YouTube cannot go below 0.25×. */
export const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2];
const FRAME = 1 / 30;

/** The speed as a button; one tap shows every speed, a second picks one. */
export function SpeedControl({ rate, onRate, youtube = false, className = '' }: { rate: number; onRate: (r: number) => void; youtube?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const speeds = SPEEDS.filter((s) => !youtube || s >= 0.25);
  return (
    <span className="speed-ctl" ref={box}>
      <button className={`${className} ${rate < 1 ? 'slow' : ''}`} onClick={() => setOpen(!open)} title="Playback speed" aria-expanded={open}>{rate}×</button>
      {open && (
        <span className={`speed-pop ${(box.current?.getBoundingClientRect().left ?? 0) < window.innerWidth / 2 ? 'from-left' : ''}`} role="menu">
          {speeds.map((s) => (
            <button key={s} role="menuitemradio" aria-checked={s === rate} className={s === rate ? 'on' : ''} onClick={() => { onRate(s); setOpen(false); }}>{s}×</button>
          ))}
        </span>
      )}
    </span>
  );
}

/** Step one frame back or forward (pauses first). Only for video files: YouTube cannot show single frames. */
export function FrameStep({ player, className = '' }: { player: React.RefObject<PlayerHandle | null>; className?: string }) {
  const step = (dir: number) => { const p = player.current; if (!p) return; p.pause(); p.seekBy(dir * FRAME); };
  return (
    <>
      <button className={className} onClick={() => step(-1)} title="One frame back">◂|</button>
      <button className={className} onClick={() => step(1)} title="One frame forward">|▸</button>
    </>
  );
}
