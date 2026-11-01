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
  /** The part of the video in view when zoomed in, as fractions of the picture (null: all of it). */
  view(): { x: number; y: number; w: number; h: number } | null;
  resetZoom(): void;
}

interface Props {
  /**
   * [remote]: streamed from the team's storage (plays like a file, but its frames cannot be read for the AI check).
   * [group]: a new URL of the same group (another size, a renewed link) continues where the last one was.
   */
  source: { type: 'youtube'; id: string } | { type: 'file'; url: string; remote?: boolean; group?: string } | null;
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
  // Where the file was (kept while it plays), to go on from there after a switch within the group.
  const was = useRef<{ group: string; t: number; playing: boolean; rate: number } | null>(null);
  const resume = useRef<typeof was.current>(null);
  const fileGroup = source?.type === 'file' ? source.group : undefined;
  const fileUrl = source?.type === 'file' ? source.url : null;
  const lastUrl = useRef(fileUrl);
  if (lastUrl.current !== fileUrl) {
    lastUrl.current = fileUrl;
    resume.current = fileGroup && was.current?.group === fileGroup ? was.current : null;
  }
  const remember = () => {
    const v = video.current;
    if (v && fileGroup && v.readyState > 0 && !resume.current) was.current = { group: fileGroup, t: v.currentTime, playing: !v.paused, rate: v.playbackRate };
  };
  const ytHost = useRef<HTMLDivElement>(null);
  const yt = useRef<any>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const lastTap = useRef<{ t: number; x: number } | null>(null);
  const tapTimer = useRef<number | undefined>(undefined);
  const stateCb = useRef(onStateChange);
  stateCb.current = onStateChange;
  // Zoom: s = scale, (x, y) = top left of the part in view, as fractions of the box.
  const [zoom, setZoomState] = useState({ s: 1, x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const setZoom = (z: { s: number; x: number; y: number }) => {
    const s = Math.min(5, Math.max(1, z.s));
    const w = 1 / s;
    const next = s === 1 ? { s: 1, x: 0, y: 0 } : { s, x: Math.min(1 - w, Math.max(0, z.x)), y: Math.min(1 - w, Math.max(0, z.y)) };
    zoomRef.current = next;
    setZoomState(next);
  };
  /** Zooms by [factor] keeping the point (fx, fy) of the box (fractions) where it is. */
  const zoomAt = (factor: number, fx: number, fy: number) => {
    const z = zoomRef.current;
    const s = Math.min(5, Math.max(1, z.s * factor));
    const px = z.x + fx / z.s, py = z.y + fy / z.s;
    setZoom({ s, x: px - fx / s, y: py - fy / s });
  };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; moved: boolean } | null>(null);
  useEffect(() => { setZoom({ s: 1, x: 0, y: 0 }); }, [source?.type === 'file' ? source.url : source?.type === 'youtube' ? source.id : null]);

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
    view: () => {
      const z = zoomRef.current;
      if (z.s <= 1) return null;
      // The box shows the video letterboxed: turn the part of the box in view into a part of the picture.
      const v = video.current;
      const box = v?.parentElement?.parentElement;
      const ar = v && v.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9;
      const br = box ? box.clientWidth / Math.max(1, box.clientHeight) : 16 / 9;
      const pw = ar >= br ? 1 : ar / br, ph = ar >= br ? br / ar : 1;
      const ox = (1 - pw) / 2, oy = (1 - ph) / 2;
      const w = 1 / z.s;
      const x0 = Math.max(0, (z.x - ox) / pw), y0 = Math.max(0, (z.y - oy) / ph);
      const x1 = Math.min(1, (z.x + w - ox) / pw), y1 = Math.min(1, (z.y + w - oy) / ph);
      return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    },
    resetZoom: () => setZoom({ s: 1, x: 0, y: 0 }),
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

  // Two fingers pinch to zoom; one finger (or the mouse) drags the zoomed picture around.
  const frac = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = el.getBoundingClientRect();
    return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
  };
  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), moved: true };
    } else gesture.current = { dist: 0, moved: false };
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !gesture.current) return;
    const el = e.currentTarget;
    if (pointers.current.size >= 2) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.dist > 0) {
        const { fx, fy } = frac({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }, el);
        zoomAt(dist / gesture.current.dist, fx, fy);
      }
      gesture.current.dist = dist;
      return;
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    if (zoomRef.current.s > 1 && (gesture.current.moved || Math.hypot(dx, dy) > 8)) {
      const r = el.getBoundingClientRect();
      const z = zoomRef.current;
      setZoom({ ...z, x: z.x - dx / r.width / z.s, y: z.y - dy / r.height / z.s });
      gesture.current.moved = true;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }
  function onUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    // A pinch or a drag is not a tap.
    if (!g?.moved) onTap(e);
  }
  // Mouse wheel (Ctrl + wheel, or a trackpad pinch) zooms; once zoomed, the wheel alone does.
  // A native listener: React's is passive, so it could not keep the page from scrolling.
  const touchEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = touchEl.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.altKey && zoomRef.current.s === 1) return;
      e.preventDefault();
      const { fx, fy } = frac(e, el);
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, fx, fy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

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
      <div className="video-zoom" style={zoom.s > 1 ? { transform: `scale(${zoom.s}) translate(${-zoom.x * 100}%, ${-zoom.y * 100}%)` } : undefined}>
      {source.type === 'youtube' ? (
        <div ref={ytHost} className="video-fill" />
      ) : (
        <video
          ref={video}
          className="video-fill"
          src={source.url}
          playsInline
          preload="auto"
          onPlay={() => { onStateChange?.(true); remember(); }}
          onPause={() => { onStateChange?.(false); remember(); }}
          onTimeUpdate={remember}
          onRateChange={remember}
          onLoadedMetadata={(e) => {
            const r = resume.current;
            resume.current = null;
            if (!r) return;
            const v = e.currentTarget;
            v.currentTime = r.t;
            v.playbackRate = r.rate;
            if (r.playing) v.play().catch(() => {});
          }}
          onLoadStart={() => setLoad('loading')}
          onWaiting={() => setLoad('waiting')}
          onCanPlay={() => setLoad((l) => (l === 'error' ? l : null))}
          onPlaying={() => setLoad(null)}
          onError={() => { setLoad('error'); onError?.(); }}
        />
      )}
      </div>
      <div className="video-touch" ref={touchEl} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onPointerCancel={(e) => { pointers.current.delete(e.pointerId); gesture.current = null; }} />
      {zoom.s > 1 && <button className="video-zoom-reset" onClick={() => setZoom({ s: 1, x: 0, y: 0 })} title="Show the whole picture">{zoom.s.toFixed(1)}× · 1×</button>}
      {flash && <div className="video-flash">{flash}</div>}
      {source.type === 'file' && load && (load !== 'loading' || source.remote) && (
        <div className="video-status">
          {load === 'error' ? 'The video could not be loaded.' : load === 'slow' ? 'Loading video… (slow connection?)' : 'Loading video…'}
        </div>
      )}
    </div>
  );
});
