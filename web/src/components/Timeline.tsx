import { useEffect, useRef, useState } from 'react';
import type { VEvent } from '../lib/api';
import { fmtTime } from './TagPad';
import type { PlayerHandle } from './VideoPlayer';

/**
 * The whole video as a bar: drag to any moment (the picture follows while dragging), with the
 * time and the length, the saved tags as small marks and where each set starts.
 */
export function Timeline({ player, events = [] }: { player: React.RefObject<PlayerHandle | null>; events?: VEvent[] }) {
  const [t, setT] = useState(0);
  const [dur, setDur] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const lastSeek = useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const p = player.current;
      if (!p) return;
      setDur(p.duration());
      setT(p.time() ?? 0);
    }, 400);
    return () => clearInterval(timer);
  }, [player]);
  if (!dur) return null;

  // Tags and set starts, as fractions of the video.
  const tags = events.filter((e) => e.t != null && e.t <= dur && e.status === 'confirmed').map((e) => ({ t: e.t!, set: e.set_no ?? 1 })).sort((a, b) => a.t - b.t);
  const sets: { set: number; t: number }[] = [];
  for (const x of tags) if (!sets.some((s) => s.set === x.set)) sets.push(x);

  const shown = drag ?? t;
  const seek = (v: number, final: boolean) => {
    // While dragging the picture follows a few times a second; on release it goes exactly there.
    const now = Date.now();
    if (final || now - lastSeek.current > 300) { player.current?.seek(v); lastSeek.current = now; }
  };
  return (
    <div className="timeline">
      <span className="timeline-time">{fmtTime(shown)}</span>
      <div className="timeline-track">
        <svg className="timeline-marks" viewBox="0 0 1000 10" preserveAspectRatio="none" aria-hidden="true">
          {tags.map((x, i) => <line key={i} x1={(x.t / dur) * 1000} x2={(x.t / dur) * 1000} y1={2} y2={8} />)}
        </svg>
        {sets.length > 1 && sets.map((s) => (
          <span key={s.set} className="timeline-set" style={{ left: `${(s.t / dur) * 100}%` }}>S{s.set}</span>
        ))}
        <input type="range" min={0} max={Math.round(dur)} step={1} value={Math.round(shown)} aria-label="Video position"
          onChange={(e) => { const v = Number(e.target.value); setDrag(v); seek(v, false); }}
          onPointerUp={(e) => { const v = Number((e.target as HTMLInputElement).value); seek(v, true); setT(v); setDrag(null); }}
          onKeyUp={(e) => { const v = Number((e.target as HTMLInputElement).value); seek(v, true); setT(v); setDrag(null); }}
          onBlur={() => setDrag(null)} />
      </div>
      <span className="timeline-time muted">{fmtTime(dur)}</span>
    </div>
  );
}

/**
 * Fine scrubbing: a strip with the 10 seconds around the current moment, to put the video on the
 * exact ball contact (tag times count to the tenth). Dragging pauses the video and moves it in
 * 0.04 s steps; the strip stays put while you drag. Tags in view show as marks.
 */
export function FineScrub({ player, events = [], span = 10 }: { player: React.RefObject<PlayerHandle | null>; events?: VEvent[]; span?: number }) {
  const [t, setT] = useState(0);
  const [hold, setHold] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => { if (hold == null) setT(player.current?.time() ?? 0); }, 150);
    return () => clearInterval(timer);
  }, [player, hold]);
  const dur = player.current?.duration() ?? null;
  const c = hold ?? t;
  const lo = Math.max(0, Math.min(c - span / 2, (dur ?? Infinity) - span));
  const hi = lo + span;
  const at = (v: number) => `${((v - lo) / span) * 100}%`;
  const tags = events.filter((e) => e.t != null && e.t >= lo && e.t <= hi && e.status === 'confirmed');
  const seconds = Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => Math.ceil(lo) + i);
  return (
    <div className="fine-scrub">
      <span className="timeline-time">{fmtTime(t)}.{Math.floor((t % 1) * 10)}</span>
      <div className="fine-track">
        {seconds.map((s) => <span key={s} className="fine-tick" style={{ left: at(s) }}>{s % 5 === 0 ? fmtTime(s) : ''}</span>)}
        {tags.map((e) => <span key={e.id} className="fine-tag" style={{ left: at(e.t!) }} />)}
        <input type="range" min={lo} max={hi} step={0.04} value={Math.min(hi, Math.max(lo, t))} aria-label="Fine position (10 seconds around now)"
          onPointerDown={() => { player.current?.pause(); setHold(t); }}
          onChange={(e) => { const v = Number(e.target.value); setT(v); player.current?.seek(v); }}
          onPointerUp={() => setHold(null)} onKeyUp={() => setHold(null)} onBlur={() => setHold(null)} />
      </div>
      <span className="timeline-time muted">±5 s</span>
    </div>
  );
}
