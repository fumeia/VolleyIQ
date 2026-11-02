import type { PlayerHandle } from '../components/VideoPlayer';
import { isApp } from './api';
import { cutPictures, fileFrame, QUARTERS, WHOLE, type Crop } from './frames';
import { Native } from './native';

/**
 * Still pictures of the video at the paused moment, for the AI (shirt numbers, line-ups),
 * from wherever the video plays:
 * - a file on this device: the frame at full resolution
 * - YouTube in the app: one second of the stream is fetched (yt-dlp on the phone), at up to 1080p
 * - YouTube in a browser: a capture of this tab, cut to the video (as sharp as the screen shows it)
 */
export type GrabWay = 'file' | 'youtube-app' | 'screen';

export function grabWay(p: PlayerHandle | null): GrabWay | null {
  if (!p) return null;
  if (p.fileUrl()) return 'file';
  if (!p.youtubeId()) return null;
  if (isApp()) return 'youtube-app';
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices ? 'screen' : null;
}

export const GRAB_NOTE: Record<GrabWay, string> = {
  file: '',
  'youtube-app': 'The picture is fetched from YouTube (a few seconds; uses a little mobile data).',
  screen: 'The browser asks to share this tab: allow it once per picture. Make the video as big as you can first; the picture is as sharp as your screen shows it.',
};

/**
 * What to send: 'whole' the full frame, 'view' the zoomed-in part (the whole frame when not
 * zoomed), 'quarters' four overlapping quarters (of the view when zoomed).
 */
export type Piece = 'whole' | 'view' | 'quarters';

export async function grabPictures(p: PlayerHandle, pieces: Piece[], maxSide = 1600): Promise<{ t: number; zoomed: boolean; data: string[][] }> {
  const way = grabWay(p);
  if (!way) throw new Error('No video to take a picture from');
  p.pause();
  const t = p.time() ?? 0;
  const view = p.view();
  const inView = (c: Crop): Crop => (view ? { x: view.x + c.x * view.w, y: view.y + c.y * view.h, w: c.w * view.w, h: c.h * view.h } : c);
  const parts = (piece: Piece, shown: boolean): Crop[] => {
    // A screen capture already shows only the zoomed part.
    const v = shown ? WHOLE : inView(WHOLE);
    if (piece === 'whole') return [WHOLE];
    if (piece === 'view') return [v];
    return QUARTERS.map((q) => (shown ? q : inView(q)));
  };
  if (way === 'file') {
    return { t, zoomed: !!view, data: await fileFrame(p.fileUrl()!, t, pieces.map((x) => parts(x, false)), maxSide) };
  }
  if (way === 'youtube-app') {
    const r = await Native.youtubeFrame({ url: `https://www.youtube.com/watch?v=${p.youtubeId()}`, t });
    const img = await loadImage(`data:image/jpeg;base64,${r.data}`);
    return { t, zoomed: !!view, data: pieces.map((x) => cutPictures(img, img.naturalWidth, img.naturalHeight, parts(x, false), maxSide)) };
  }
  const shot = await captureBox(p, t);
  return { t, zoomed: !!view, data: pieces.map((x) => cutPictures(shot, shot.width, shot.height, parts(x, true), maxSide)) };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The picture could not be read'));
    img.src = src;
  });
}

/**
 * A capture of this tab, cut to the video box. YouTube's embed lets no page read its pixels,
 * but the browser can share the tab the way it does for a video call.
 */
async function captureBox(p: PlayerHandle, t: number): Promise<HTMLCanvasElement> {
  const box = p.box();
  if (!box) throw new Error('No video on screen');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' }, audio: false,
      // Chrome: offer this tab first; ignored elsewhere.
      preferCurrentTab: true, selfBrowserSurface: 'include',
    } as DisplayMediaStreamOptions);
  } catch {
    throw new Error('Sharing the tab was not allowed, so no picture could be taken');
  }
  const v = document.createElement('video');
  let rate: number | null = null;
  try {
    const settings = stream.getVideoTracks()[0]?.getSettings() as MediaTrackSettings & { displaySurface?: string };
    if (settings?.displaySurface && settings.displaySurface !== 'browser') throw new Error('Share this tab (not a window or the whole screen)');
    v.muted = true;
    v.srcObject = stream;
    await v.play();
    // A paused YouTube embed covers part of the picture (suggestions, the play button): let it play
    // in slow motion for a moment, so the overlay goes away, while the "sharing this tab" bar settles.
    rate = p.rate();
    p.setRate(0.25);
    p.play();
    await new Promise((r) => setTimeout(r, 700));
    const W = v.videoWidth, H = v.videoHeight;
    const r = box.getBoundingClientRect();
    const sx = W / window.innerWidth, sy = H / window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(r.width * sx));
    canvas.height = Math.max(1, Math.round(r.height * sy));
    canvas.getContext('2d')!.drawImage(v, r.left * sx, r.top * sy, r.width * sx, r.height * sy, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    if (rate != null) { p.pause(); p.setRate(rate); p.seek(t); }
    stream.getTracks().forEach((tr) => tr.stop());
    v.srcObject = null;
  }
}
