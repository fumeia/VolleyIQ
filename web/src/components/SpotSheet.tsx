import { useLayoutEffect, useState, type ReactNode } from 'react';
import type { Pt } from '../lib/court';
import { CourtFull } from './CourtFull';

interface Props {
  title: string;
  prompt: string;
  /** "1/2", "2/2", or nothing for a single tap. */
  step?: string;
  from?: Pt | null;
  to?: Pt | null;
  flip?: boolean;
  showTarget?: boolean;
  onPick: (p: Pt) => void;
  skipLabel: string;
  onSkip: () => void;
  onBack?: () => void;
  /** Extra quick buttons (e.g. the pass grades 0-3), above Back / Skip. */
  extra?: ReactNode;
}

/** The area below the video (portrait) or next to it (landscape), so the court can take all of it. */
export function useBelowVideo() {
  const [box, setBox] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const video = document.querySelector('.ws-video')?.getBoundingClientRect();
      const head = document.querySelector('.ws-head')?.getBoundingClientRect();
      const top = head?.bottom ?? 0;
      if (!video || video.height === 0) setBox({ top, left: 0 });
      else if (video.right < window.innerWidth * 0.85) setBox({ top, left: video.right }); // side by side
      else setBox({ top: Math.max(top, video.bottom), left: 0 });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, []);
  return box;
}

/**
 * Court spots on a screen of their own: it covers everything below the video as soon
 * as player and action are known, and closes after the last tap. The court is drawn as
 * the camera sees it, so a spot is tapped where it is in the video.
 */
export function SpotSheet({ title, prompt, step, from, to, flip, showTarget, onPick, skipLabel, onSkip, onBack, extra }: Props) {
  const box = useBelowVideo();
  return (
    <div className="spot-sheet" style={{ top: box.top, left: box.left }}>
      <div className="spot-head">
        <span><b>{title}</b> · {prompt}{step ? <small className="muted"> ({step})</small> : null}</span>
      </div>
      <div className="spot-court">
        <CourtFull from={from} to={to} flip={flip} showTarget={showTarget} label={prompt} onPick={onPick} />
      </div>
      {extra}
      <div className="spot-actions">
        {onBack && <button className="btn" onClick={onBack}>◀ Back</button>}
        <button className="btn" onClick={onSkip}>{skipLabel}</button>
      </div>
    </div>
  );
}
