import { useEffect, useState } from 'react';
import type { PlayerHandle } from '../components/VideoPlayer';

/**
 * The video's current time, read every [paused] ms while the video stands (it only changes on a
 * seek, and an unchanged value does not redraw anything) and every [playing] ms while it plays:
 * each change redraws part of the page, which in the app competes with the video for drawing.
 */
export function useVideoTime(player: React.RefObject<PlayerHandle | null>, { paused = 150, playing = 500, enabled = true } = {}) {
  const [t, setT] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const tick = () => {
      const p = player.current;
      setT(p?.time() ?? null);
      timer = window.setTimeout(tick, p?.isPlaying() ? playing : paused);
    };
    tick();
    return () => clearTimeout(timer);
  }, [player, paused, playing, enabled]);
  return t;
}
