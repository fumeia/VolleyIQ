import { Capacitor, registerPlugin } from '@capacitor/core';
import { isApp } from './api';

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
    readJerseys: boolean; detectCuts: boolean; sensitivity?: number; ourHalf?: 'near' | 'far' | null; corners?: number[] | null;
  }): Promise<{ id: string; uploadId: string }>;
  analysisStatus(o: { matchId: number }): Promise<{ analysis: WorkState | null; upload: WorkState | null }>;
  cancelAnalysis(o: { matchId: number }): Promise<void>;
  deleteVideo(o: { uri: string }): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
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
