import { Capacitor, registerPlugin } from '@capacitor/core';
import { isApp } from './api';
import type { Segment } from './calibration';

/** Native side of the Android app (web/android/.../VolleyIQPlugin.kt). */
export interface WorkState {
  id: string;
  state: 'enqueued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled';
  progress: number;          // 0..1, or < 0 when unknown
  message?: string | null;
  error?: string | null;
  uri?: string;              // imports: the downloaded file
  name?: string;
  count?: number;            // analysis/upload: number of suggestions
}

export interface PickedVideo { uri: string; name: string; size: number; durationMs: number }

interface VolleyIQPlugin {
  pickVideo(): Promise<PickedVideo>;
  checkVideo(o: { uri: string }): Promise<{ ok: boolean }>;
  importLink(o: { url: string }): Promise<{ id: string }>;
  workStatus(o: { id: string }): Promise<{ work: WorkState | null }>;
  cancelWork(o: { id: string }): Promise<void>;
  analyze(o: {
    matchId: number; uri: string; apiBase: string; token: string | null; roster: number[];
    readJerseys: boolean; detectCuts: boolean; sensitivity?: number;
    /** Learned from the tagged matches (server: /api/detector). */
    threshold?: number; sustainMax?: number; ourHalf?: 'near' | 'far' | null; points?: number[] | null;
    /** Per set: from each side switch on, our half (and the court marking if it was re-marked). */
    segments?: Segment[] | null;
  }): Promise<{ id: string; uploadId: string }>;
  analysisStatus(o: { matchId: number }): Promise<{ analysis: WorkState | null; upload: WorkState | null }>;
  /** The AI check of every rally as a background job ([job]: JSON, see AiCheckWorker.kt). */
  aiCheckAll(o: { matchId: number; job: string }): Promise<{ id: string }>;
  aiCheckStatus(o: { matchId: number }): Promise<{ work: WorkState | null }>;
  cancelAiCheck(o: { matchId: number }): Promise<void>;
  /** Upload the match video into the team's storage in the background (resumes after a break). */
  uploadVideo(o: { matchId: number; uri: string; apiBase: string; token: string | null }): Promise<void>;
  videoUploadStatus(o: { matchId: number }): Promise<{ work: WorkState | null }>;
  cancelVideoUpload(o: { matchId: number }): Promise<void>;
  cancelAnalysis(o: { matchId: number }): Promise<void>;
  deleteVideo(o: { uri: string }): Promise<void>;
  /** One frame of a YouTube video at [t] s, fetched with yt-dlp (base64 JPEG, up to 1080p). */
  youtubeFrame(o: { url: string; t: number }): Promise<{ data: string; width: number; height: number }>;
  requestNotifications(): Promise<{ granted: boolean }>;
  /** Android's print dialog for the page as it is now (offers Save as PDF). */
  print(o: { name: string }): Promise<void>;
  appInfo(): Promise<{ version: string; build: number; android: string; device: string; canInstall: boolean }>;
  /** Downloads the APK at [url] (with the login token) as a background job, then opens Android's installer. */
  installUpdate(o: { url: string; token: string | null }): Promise<void>;
  addListener(event: 'updateProgress', cb: (p: { done: number; total: number }) => void): Promise<{ remove: () => void }>;
}

export const Native = registerPlugin<VolleyIQPlugin>('VolleyIQ');

export { isApp };

/** URL the WebView can play for a content:// or file:// video on the phone. */
export const playableUrl = (uri: string) => Capacitor.convertFileSrc(uri);

/** Which phone video belongs to a match (kept on this phone only). */
export interface LocalVideo { uri: string; name: string }

export function localVideo(matchId: number): LocalVideo | null {
  try { return JSON.parse(localStorage.getItem(`viq:video:${matchId}`) ?? 'null'); } catch { return null; }
}

export function setLocalVideo(matchId: number, v: LocalVideo | null) {
  try {
    if (v) localStorage.setItem(`viq:video:${matchId}`, JSON.stringify(v));
    else localStorage.removeItem(`viq:video:${matchId}`);
  } catch { /* storage unavailable */ }
}

/** Links we can import on the phone (anything yt-dlp knows plus file-sharing services). */
export function describeLink(url: string): string {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  if (/wetransfer\.com$|^we\.tl$/.test(host)) return 'WeTransfer';
  if (/drive\.google\.com$|docs\.google\.com$/.test(host)) return 'Google Drive';
  if (/dropbox\.com$/.test(host)) return 'Dropbox';
  if (/youtube\.com$|youtu\.be$/.test(host)) return 'YouTube';
  if (/vimeo\.com$/.test(host)) return 'Vimeo';
  return host || 'link';
}

/** Print / save as PDF: the browser's print, or in the app Android's print service (the WebView has no window.print). */
export function printPage(name: string) {
  if (isApp()) return Native.print({ name }).catch((e) => alert(`Could not open printing: ${e?.message ?? e}`));
  window.print();
}
