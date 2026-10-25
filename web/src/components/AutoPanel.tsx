import { useEffect, useRef, useState } from 'react';
import { api, serverBase, type Match, type Player } from '../lib/api';
import { flatPoints, segments, type Calibration } from '../lib/calibration';
import { SidesPanel } from './Calibration';
import { isApp, Native, type LocalVideo, type WorkState } from '../lib/native';

interface Props {
  match: Match;
  players: Player[];
  video: LocalVideo | null;
  /** Open the court marking; from = video time for a re-marking later in the match. */
  onCalibrate: (from: number | null) => void;
  onCalibration: (c: Calibration) => void;
  getTime: () => number | null;
  onDone: () => void;
}

/**
 * First pass, run on the phone: finds ball contacts (sound), edit cuts
 * (picture), rallies, and optionally jersey numbers and court sides. Results
 * land in Review. Runs as a background job with a notification.
 */
export function AutoPanel({ match, players, video, onCalibrate, onCalibration, getTime, onDone }: Props) {
  const roster = players.filter((p) => p.active && p.number != null).map((p) => p.number!);
  const [readJerseys, setReadJerseys] = useState(roster.length > 0);
  const [detectCuts, setDetectCuts] = useState(true);
  // Remembered per match, so a re-run uses the same value unless you change it.
  const sensKey = `viq:sensitivity:${match.id}`;
  const [sensitivity, setSensitivityState] = useState(() => { try { return Number(localStorage.getItem(sensKey)) || 1; } catch { return 1; } });
  const setSensitivity = (v: number) => { setSensitivityState(v); try { localStorage.setItem(sensKey, String(v)); } catch { /* private mode */ } };
  const [status, setStatus] = useState<{ analysis: WorkState | null; upload: WorkState | null } | null>(null);
  const [err, setErr] = useState('');
  const handled = useRef<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const running = !!status && (isActive(status.analysis) || isActive(status.upload));

  useEffect(() => {
    if (!isApp()) return;
    let stop = false;
    const tick = async () => {
      const s = await Native.analysisStatus({ matchId: match.id }).catch(() => null);
      if (stop || !s) return;
      setStatus(s);
      // Reload once per finished upload, then show the suggestions.
      if (s.upload?.state === 'succeeded' && handled.current !== s.upload.id) {
        const first = handled.current === null;
        handled.current = s.upload.id;
        if (!first) done.current();
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => { stop = true; clearInterval(t); };
  }, [match.id]);

  if (!isApp()) {
    return (
      <div className="pad">
        <p><b>Auto-detection runs in the VolleyIQ Android app</b>, on the phone where the video is. It finds rallies and ball
          touches, guesses the action, and reads jersey numbers. The suggestions then show up here in <b>Review</b>.</p>
        <p className="muted small">Install it from the project's GitHub Releases page ("VolleyIQ Android (latest build)").</p>
      </div>
    );
  }

  async function run() {
    if (!video) return;
    setErr('');
    try {
      await Native.requestNotifications().catch(() => {});
      const cal = match.calibration;
      handled.current = handled.current ?? 'none';
      await Native.analyze({
        matchId: match.id,
        uri: video.uri,
        apiBase: serverBase(),
        token: api.token(),
        roster,
        readJerseys,
        detectCuts,
        sensitivity,
        ourHalf: cal?.ourHalf ?? null,
        points: cal ? flatPoints(cal) : null,
        segments: cal ? segments(cal) : null,
      });
      setStatus({ analysis: { id: '', state: 'enqueued', progress: 0, message: 'Starting…' }, upload: null });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const a = status?.analysis;
  const u = status?.upload;
  return (
    <div className="pad">
      <p>
        <b>Auto-detection</b> runs on this phone and keeps going in the background. It listens for ball contacts,
        spots edit cuts and rallies, guesses each touch (serve, receive, set, attack, dig) and can read jersey numbers.
        Everything lands in <b>Review</b>, where one tap confirms or fixes it.
      </p>
      {!video && <div className="card notice">Load the match video on this phone first (pick a file or import a link).</div>}

      <label className="toggle">
        <input type="checkbox" checked={readJerseys} onChange={(e) => setReadJerseys(e.target.checked)} />
        Read jersey numbers {roster.length === 0 && <small className="muted">(add numbers to the roster first)</small>}
      </label>
      <label className="toggle">
        <input type="checkbox" checked={detectCuts} onChange={(e) => setDetectCuts(e.target.checked)} />
        Video is edited (rallies cut together)
      </label>
      <label className="field-label">
        Touch sensitivity: {sensitivity.toFixed(1)}× {sensitivity > 1.2 ? '(finds more, also more false ones)' : sensitivity < 0.9 ? '(fewer false touches, may miss quiet ones)' : ''}
      </label>
      <input type="range" min={0.6} max={1.8} step={0.1} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} />

      <div className="row wrap calib-status">
        {match.calibration ? (
          <SidesPanel calibration={match.calibration} getTime={getTime} onChange={onCalibration} onMark={onCalibrate} />
        ) : (
          <>
            <span className="small muted">Optional: calibrate the court so the phone can tell our touches from theirs.</span>
            <button className="btn-ghost small" onClick={() => onCalibrate(null)}>Calibrate court</button>
          </>
        )}
      </div>

      <button className="btn btn-primary wide" disabled={!video || running} onClick={run}>
        {running ? 'Analysing…' : '✨ Run auto-detection'}
      </button>
      {running && <button className="btn-ghost small" onClick={() => Native.cancelAnalysis({ matchId: match.id })}>Cancel</button>}

      {a && (
        <div className="job">
          <div className="progress"><div style={{ width: `${Math.round(Math.max(0.02, a.progress) * 100)}%` }} /></div>
          <span className="small">{label(a, u)}</span>
        </div>
      )}
      {err && <p className="error small">{err}</p>}
      <p className="muted small">
        Re-running replaces suggestions you have not confirmed yet; confirmed tags are never touched. If the phone is
        offline, the results upload automatically once it is back online.
      </p>
    </div>
  );
}

const isActive = (w: WorkState | null | undefined) => !!w && ['enqueued', 'running', 'blocked'].includes(w.state);

function label(a: WorkState, u: WorkState | null | undefined) {
  if (a.state === 'failed') return `Failed: ${a.error ?? 'unknown error'}`;
  if (a.state === 'cancelled') return 'Cancelled';
  if (a.state !== 'succeeded') return a.message ?? 'Working…';
  if (!u || u.state === 'enqueued' || u.state === 'blocked') return 'Analysis done · waiting for a connection to upload…';
  if (u.state === 'running') return 'Uploading suggestions…';
  if (u.state === 'failed') return `Upload failed: ${u.error ?? ''}`;
  if (u.state === 'succeeded') return `Done · ${u.count ?? 0} touches suggested. Open Review.`;
  return u.state;
}
