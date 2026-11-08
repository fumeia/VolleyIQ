import type { PlayerHandle } from './VideoPlayer';
import { useVideoTime } from '../lib/useVideoTime';
import { fmtTime } from './TagPad';

/** Current video time (to the tenth of a second), shown on the video. */
export function VideoClock({ player }: { player: React.RefObject<PlayerHandle | null> }) {
  const t = useVideoTime(player, { playing: 500 });
  if (t == null) return null;
  return <div className="video-clock" aria-label="Video time">{fmtTime(t)}.{Math.floor((t % 1) * 10)}</div>;
}
