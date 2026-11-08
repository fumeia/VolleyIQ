/**
 * Still frames from a local video file, for the AI touch check: one picture per
 * touch with three moments (just before, at and just after the sound) and a label,
 * as a small JPEG. A hidden second <video> does the seeking, so playback is left alone.
 */

export const FRAME_OFFSETS = [-0.3, 0, 0.2];
const CELL_W = 640;
const CELL_H = 360;

function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not read the video at this time')); };
    const timer = window.setTimeout(fail, 5000);
    const cleanup = () => { clearTimeout(timer); v.removeEventListener('seeked', done); v.removeEventListener('error', fail); };
    v.addEventListener('seeked', done);
    v.addEventListener('error', fail);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.05));
  });
}

async function openVideo(url: string) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.playsInline = true;
  // The app's local video server is another origin: ask for CORS so the frames can be read.
  if (url.startsWith('http://127.0.0.1:')) v.crossOrigin = 'anonymous';
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The video did not load')), 10000);
    v.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(timer); reject(new Error('The video could not be opened')); }, { once: true });
  });
  return v;
}

/** Draws [v]'s current frame into a cell, letterboxed. */
function drawCell(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, cx: number, cy: number) {
  const s = Math.min(CELL_W / v.videoWidth, CELL_H / v.videoHeight);
  const w = v.videoWidth * s, h = v.videoHeight * s;
  ctx.drawImage(v, cx + (CELL_W - w) / 2, cy + (CELL_H - h) / 2, w, h);
}

/** One 2×2 picture per time in [times] (frames at FRAME_OFFSETS, then a label), as base64 JPEG. */
export async function touchPictures(url: string, times: number[], label: (k: number) => string, onProgress?: (done: number) => void): Promise<string[]> {
  const v = await openVideo(url);
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * 2;
  canvas.height = CELL_H * 2;
  const ctx = canvas.getContext('2d')!;
  const out: string[] = [];
  try {
    for (let k = 0; k < times.length; k++) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let j = 0; j < FRAME_OFFSETS.length; j++) {
        await seek(v, times[k] + FRAME_OFFSETS[j]);
        drawCell(ctx, v, (j % 2) * CELL_W, Math.floor(j / 2) * CELL_H);
      }
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 44px sans-serif';
      ctx.fillText(label(k), CELL_W + 30, CELL_H + 90);
      ctx.font = '26px sans-serif';
      ctx.fillText('top left: 0.3 s before · top right: at the sound', CELL_W + 30, CELL_H + 150);
      ctx.fillText('bottom left: 0.2 s after', CELL_W + 30, CELL_H + 190);
      out.push(canvas.toDataURL('image/jpeg', 0.65).split(',')[1]);
      onProgress?.(k + 1);
    }
  } finally {
    v.removeAttribute('src');
    v.load();
  }
  return out;
}

export interface Crop { x: number; y: number; w: number; h: number }

/** The four overlapping quarters of a picture (an AI model shrinks big pictures, so a whole frame would lose the numbers). */
export const QUARTERS: Crop[] = [[0, 0], [0.4, 0], [0, 0.4], [0.4, 0.4]].map(([x, y]) => ({ x, y, w: 0.6, h: 0.6 }));
export const WHOLE: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** Cuts [parts] (fractions of the picture) out of a W×H picture, each at most [maxSide] px, as base64 JPEGs. */
export function cutPictures(img: CanvasImageSource, W: number, H: number, parts: Crop[], maxSide = 1600): string[] {
  return parts.map((p) => {
    const sx = p.x * W, sy = p.y * H, sw = p.w * W, sh = p.h * H;
    const s = Math.min(1, maxSide / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * s));
    canvas.height = Math.max(1, Math.round(sh * s));
    canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  });
}

/**
 * Pictures of the frame at [t] for reading shirt numbers, at the video's full resolution:
 * the part in [crop] (fractions of the picture, e.g. the zoomed-in view) as one picture, or
 * without a crop the whole frame cut into four overlapping quarters. As base64 JPEGs.
 */
export async function stillFrames(url: string, t: number, crop: Crop | null, maxSide = 1600): Promise<string[]> {
  return fileFrame(url, t, [crop ? [crop] : QUARTERS], maxSide).then((x) => x.flat());
}

/** The frame at [t] of a video file, cut into each list of parts in [sets]. */
export async function fileFrame(url: string, t: number, sets: Crop[][], maxSide = 1600): Promise<string[][]> {
  const v = await openVideo(url);
  try {
    await seek(v, t);
    return sets.map((parts) => cutPictures(v, v.videoWidth, v.videoHeight, parts, maxSide));
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}
