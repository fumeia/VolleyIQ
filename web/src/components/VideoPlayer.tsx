import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/** Uniform control surface over YouTube embeds and HTML5 <video>. */
export interface PlayerHandle {
  play(): void;
  pause(): void;
  toggle(): void;
  isPlaying(): boolean;
  time(): number | null;
  seek(t: number): void;
  seekBy(dt: number): void;
  setRate(r: number): void;
  ready(): boolean;
  /** Width / height of the picture (for overlays on the letterboxed video). */
  aspect(): number | null;
  /** The local video's URL, for reading still frames (null for YouTube). */
  fileUrl(): string | null;
}

interface Props {
  /** [remote]: streamed from the team's storage (plays like a file, but its frames cannot be read for the AI check). */
  source: { type: 'youtube'; id: string } | { type: 'file'; url: string; remote?: boolean } | null;
  onStateChange?: (playing: boolean) => void;
  /** The file could not be loaded (e.g. its link expired); the parent can hand in a new one. */
  onError?: () => void;
}


declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

let ytLoading: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytLoading) {
    ytLoading = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytLoading;
}

export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1, 12) || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v')!.slice(0, 11);
    const m = u.pathname.match(/\/(embed|shorts|live|v)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

export const VideoPlayer = forwardRef<PlayerHandle, Props>(function VideoPlayer({ source, onStateChange, onError }, ref) {
  // What the video is doing while it is not playing: loading, waiting for data, or failed.
  const [load, setLoad] = useState<'loading' | 'waiting' | 'slow' | 'error' | null>(null);
  useEffect(() => {
    if (load !== 'loading' && load !== 'waiting') return;
    const t = window.setTimeout(() => setLoad('slow'), 4000);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => { setLoad(null); }, [source?.type === 'file' ? source.url : null]);
  const ytHost = useRef<HTMLDivElement>(null);
  const yt = useRef<any>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const lastTap = useRef<{ t: number; x: number } | null>(null);
  const tapTimer = useRef<number | undefined>(undefined);
  const stateCb = useRef(onStateChange);
  stateCb.current = onStateChange;

  useEffect(() => {
    if (source?.type !== 'youtube' || !ytHost.current) return;
    let cancelled = false;
    const el = document.createElement('div');
    ytHost.current.appendChild(el);
    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      yt.current = new YT.Player(el, {
        videoId: source.id,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, fs: 0 },
        events: {
          onStateChange: (e: any) => stateCb.current?.(e.data === YT.PlayerState.PLAYING),
        },
      });
    });
    return () => {
      cancelled = true;
      yt.current?.destroy?.();
      yt.current = null;
      el.remove();
    };
  }, [source?.type === 'youtube' ? source.id : null]);

  const handle: PlayerHandle = {
    ready: () => (source?.type === 'youtube' ? !!yt.current?.getCurrentTime : !!video.current),
    aspect: () => {
      if (source?.type === 'youtube') return 16 / 9;
      const v = video.current;
      return v && v.videoWidth ? v.videoWidth / v.videoHeight : null;
    },
    fileUrl: () => (source?.type === 'file' && !source.remote ? source.url : null),
    play: () => (source?.type === 'youtube' ? yt.current?.playVideo?.() : video.current?.play().catch(() => {})),
    pause: () => (source?.type === 'youtube' ? yt.current?.pauseVideo?.() : video.current?.pause()),
    isPlaying: () => {
      if (source?.type === 'youtube') return yt.current?.getPlayerState?.() === 1;
      return !!video.current && !video.current.paused;
    },
    toggle: () => (handle.isPlaying() ? handle.pause() : handle.play()),
    time: () => {
      if (source?.type === 'youtube') return yt.current?.getCurrentTime ? yt.current.getCurrentTime() : null;
      return video.current ? video.current.currentTime : null;
    },
    seek: (t: number) => {
      const target = Math.max(0, t);
      if (source?.type === 'youtube') yt.current?.seekTo?.(target, true);
      else if (video.current) video.current.currentTime = target;
    },
    seekBy: (dt: number) => {
      const now = handle.time();
      if (now != null) handle.seek(now + dt);
    },
    setRate: (r: number) => {
      if (source?.type === 'youtube') yt.current?.setPlaybackRate?.(r);
      else if (video.current) video.current.playbackRate = r;
    },
  };
  useImperativeHandle(ref, () => handle);

  // Touch overlay: single tap = play/pause, double tap on left/right third = ∓5s (like YouTube mobile).
  function onTap(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < 300 && Math.abs(prev.x - x) < 0.2 && (x < 0.33 || x > 0.67)) {
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      const dt = x < 0.5 ? -5 : 5;
      handle.seekBy(dt);
      show(dt < 0 ? '« 5s' : '5s »');
      return;
    }
    lastTap.current = { t: now, x };
    clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => {
      const playing = handle.isPlaying();
      handle.toggle();
      show(playing ? '❚❚' : '▶');
    }, x < 0.33 || x > 0.67 ? 260 : 0);
  }

  function show(text: string) {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 450);
  }

  if (!source) {
    return <div className="video-box video-empty">Load a YouTube link or a video file to start</div>;
  }

  return (
    <div className="video-box">
      {source.type === 'youtube' ? (
        <div ref={ytHost} className="video-fill" />
      ) : (
        <video
          ref={video}
          className="video-fill"
          src={source.url}
          playsInline
          preload="auto"
          onPlay={() => onStateChange?.(true)}
          onPause={() => onStateChange?.(false)}
          onLoadStart={() => setLoad('loading')}
          onWaiting={() => setLoad('waiting')}
          onCanPlay={() => setLoad((l) => (l === 'error' ? l : null))}
          onPlaying={() => setLoad(null)}
          onError={() => { setLoad('error'); onError?.(); }}
        />
      )}
      <div className="video-touch" onPointerUp={onTap} />
      {flash && <div className="video-flash">{flash}</div>}
      {source.type === 'file' && load && (load !== 'loading' || source.remote) && (
        <div className="video-status">
          {load === 'error' ? 'The video could not be loaded.' : load === 'slow' ? 'Loading video… (slow connection?)' : 'Loading video…'}
        </div>
      )}
    </div>
  );
});
