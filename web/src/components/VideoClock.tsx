import { useEffect, useState } from 'react';
import type { PlayerHandle } from './VideoPlayer';
import { fmtTime } from './TagPad';

/**
 * Current video time (to the tenth of a second), shown on the video while it stands. While it
 * plays the clock is hidden: a changing number redraws part of the page, and in the app each
 * redraw cost the video a frame.
 */
export function VideoClock({ player }: { player: React.RefObject<PlayerHandle | null> }) {
  const [t, setT] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const p = player.current;
      setT(!p || p.isPlaying() ? null : p.time());
    }, 150);
    return () => clearInterval(timer);
  }, [player]);
  if (t == null) return null;
  return <div className="video-clock" aria-label="Video time">{fmtTime(t)}.{Math.floor((t % 1) * 10)}</div>;
}
