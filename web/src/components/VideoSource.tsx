import { useEffect, useRef, useState } from 'react';
import { api, type Match } from '../lib/api';
import { describeLink, isApp, Native, setLocalVideo, type LocalVideo, type WorkState } from '../lib/native';
import { parseYouTubeId } from './VideoPlayer';

/**
 * Imports a shared link to the phone in the background (WeTransfer, Drive,
 * Dropbox, YouTube, Vimeo, …). The job id is remembered so progress survives
 * leaving the screen or restarting the app.
 */
export function useImport(matchId: number, onDone: (v: LocalVideo) => void) {
  const key = `viq:import:${matchId}`;
  const [work, setWork] = useState<WorkState | null>(null);
  const [id, setId] = useState<string | null>(() => localStorage.getItem(key));
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      const { work: w } = await Native.workStatus({ id }).catch(() => ({ work: null }));
      if (stop) return;
      setWork(w);
      if (!w || ['succeeded', 'failed', 'cancelled'].includes(w.state)) {
        localStorage.removeItem(key);
        setId(null);
        if (w?.state === 'succeeded' && w.uri) done.current({ uri: w.uri, name: w.name ?? 'video.mp4' });
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { stop = true; clearInterval(t); };
  }, [id, key]);

  return {
    work,
    running: !!id,
    async start(url: string) {
      await Native.requestNotifications().catch(() => {});
      const { id: newId } = await Native.importLink({ url });
      localStorage.setItem(key, newId);
      setWork(null);
      setId(newId);
    },
    cancel() {
      if (id) Native.cancelWork({ id });
    },
  };
}

interface Props {
  match: Match;
  onLocal: (v: LocalVideo) => void;
  onMatch: (m: Match) => void;
}

export function VideoSource({ match, onLocal, onMatch }: Props) {
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const app = isApp();

  async function useLocal(v: LocalVideo) {
    setLocalVideo(match.id, v);
    onLocal(v);
    // The server only learns the file name, so the website can say where the video lives.
    if (match.video_type !== 'youtube') {
      api.updateMatch(match.id, { video_type: 'local', video_ref: v.name }).then(onMatch).catch(() => {});
    }
  }

  const imp = useImport(match.id, useLocal);

  async function submitLink() {
    setErr('');
    const url = link.trim();
    if (!url) return;
    const yt = parseYouTubeId(url);
    if (yt) onMatch(await api.updateMatch(match.id, { video_type: 'youtube', video_ref: yt }));
    if (app) {
      // In the app every link is downloaded, so it plays smoothly and can be analysed on the phone.
      try { await imp.start(url); } catch (e) { setErr((e as Error).message); }
    } else if (!yt) {
      if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)) onLocal({ uri: url, name: url.split('/').pop() ?? 'video' });
      else setErr(`${describeLink(url)} links can be imported in the Android app. On the website, use YouTube or a direct video link.`);
    }
  }

  return (
    <div className="video-source card">
      <b>Load video</b>
      {app ? (
        <button className="btn wide" onClick={async () => {
          try { useLocal(await Native.pickVideo()); } catch (e) { if ((e as { code?: string }).code !== 'CANCELLED') setErr((e as Error).message); }
        }}>📁 Pick video from this phone</button>
      ) : (
        <label className="btn wide file-btn">
          📁 Pick video file
          <input type="file" accept="video/*" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onLocal({ uri: URL.createObjectURL(f), name: f.name });
          }} />
        </label>
      )}
      <div className="row">
        <input className="input" type="url" inputMode="url" autoCapitalize="off"
          placeholder={app ? 'Link: YouTube, WeTransfer, Drive, Dropbox…' : 'YouTube or video link'}
          value={link} onChange={(e) => setLink(e.target.value)} />
        <button className="btn btn-primary" disabled={imp.running} onClick={submitLink}>{app ? 'Import' : 'Load'}</button>
      </div>
      {imp.running && (
        <div className="job">
          <div className="progress">
            <div style={{ width: `${Math.max(2, Math.round((imp.work?.progress ?? 0) * 100))}%` }} className={(imp.work?.progress ?? 0) < 0 ? 'indeterminate' : ''} />
          </div>
          <span className="small">{imp.work?.message ?? 'Starting download…'} <button className="btn-ghost small" onClick={imp.cancel}>Cancel</button></span>
        </div>
      )}
      {imp.work?.state === 'failed' && <p className="error small">Import failed: {imp.work.error}</p>}
      <p className="muted small">
        {app
          ? 'Videos stay on this phone (nothing is uploaded). Imports keep running in the background with a notification.'
          : 'Files play from your device and are not uploaded. For WeTransfer/Drive/Dropbox links and auto-detection, use the Android app.'}
      </p>
      {err && <p className="error small">{err}</p>}
    </div>
  );
}
