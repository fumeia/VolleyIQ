import { useEffect, useRef, useState } from 'react';
import { QUALITIES, type Quality } from '../lib/videoQuality';

/** The video size as a button that opens the sizes on offer (Original, 720p, 480p). */
export function QualityControl({ quality, options, onPick, className = '' }: { quality: Quality; options: Quality[]; onPick: (q: Quality) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  if (options.length < 2) return null;
  const label = (q: Quality) => QUALITIES.find((x) => x.q === q)!.label;
  return (
    <span className="speed-ctl" ref={box}>
      <button className={className} onClick={() => setOpen(!open)} title="Video quality: a smaller size loads faster on a weak connection" aria-expanded={open}>{label(quality)} ▾</button>
      {open && (
        <span className={`speed-pop ${(box.current?.getBoundingClientRect().left ?? 0) < window.innerWidth / 2 ? 'from-left' : ''}`} role="menu">
          {QUALITIES.filter((x) => options.includes(x.q)).map((x) => (
            <button key={x.q} role="menuitemradio" aria-checked={x.q === quality} className={x.q === quality ? 'on' : ''} onClick={() => { onPick(x.q); setOpen(false); }}>{x.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}
