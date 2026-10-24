import { useEffect, useState } from 'react';
import type { PlayerHandle } from './VideoPlayer';
import { fmtTime } from './TagPad';

/** Current video time (to the tenth of a second), shown on the video. */
export function VideoClock({ player }: { player: React.RefObject<PlayerHandle | null> }) {
  const [t, setT] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setT(player.current?.time() ?? null), 200);
    return () => clearInterval(timer);
  }, [player]);
  if (t == null) return null;
  return <div className="video-clock" aria-label="Video time">{fmtTime(t)}.{Math.floor((t % 1) * 10)}</div>;
}
