import { useEffect, useRef, useState } from 'react';
import type { PlayerHandle } from './VideoPlayer';

/** Playback speeds; YouTube cannot go below 0.25×. */
export const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2];
const FRAME = 1 / 30;

const SLOW_KEY = 'viq:slowRate';
const loadSlow = () => { try { const v = Number(localStorage.getItem(SLOW_KEY)); return SPEEDS.includes(v) && v < 1 ? v : 0.25; } catch { return 0.25; } };

/**
 * Slow-mo on / off with one tap (at the slow speed last picked, 0.25× at first), and the
 * speed as a button that shows every speed. Picking a speed below 1× makes it the slow-mo speed.
 */
export function SpeedControl({ rate, onRate, youtube = false, className = '' }: { rate: number; onRate: (r: number) => void; youtube?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [slow, setSlow] = useState(loadSlow);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const speeds = SPEEDS.filter((s) => !youtube || s >= 0.25);
  const slowRate = youtube ? Math.max(0.25, slow) : slow;
  const pick = (s: number) => {
    if (s < 1) { setSlow(s); try { localStorage.setItem(SLOW_KEY, String(s)); } catch { /* private mode */ } }
    onRate(s);
    setOpen(false);
  };
  return (
    <span className="speed-ctl" ref={box}>
      <button className={`${className} slowmo ${rate < 1 ? 'on' : ''}`} aria-pressed={rate < 1} onClick={() => onRate(rate < 1 ? 1 : slowRate)}
        title={rate < 1 ? 'Back to normal speed' : `Slow motion (${slowRate}×)`}>Slow-mo{rate < 1 ? ` ${rate}×` : ''}</button>
      <button className={className} onClick={() => setOpen(!open)} title="Playback speed" aria-expanded={open}>{rate}× ▾</button>
      {open && (
        <span className={`speed-pop ${(box.current?.getBoundingClientRect().left ?? 0) < window.innerWidth / 2 ? 'from-left' : ''}`} role="menu">
          {speeds.map((s) => (
            <button key={s} role="menuitemradio" aria-checked={s === rate} className={s === rate ? 'on' : ''} onClick={() => pick(s)}>{s}×</button>
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
      <button className={className} onClick={() => step(-1)} title="One frame back">‹ frame</button>
      <button className={className} onClick={() => step(1)} title="One frame forward">frame ›</button>
    </>
  );
}
