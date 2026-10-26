import { useEffect, useRef, useState } from 'react';
import { api, serverBase, type Match, type Player, type VEvent } from '../lib/api';
import { aiPrefs } from '../lib/aiCheck';
import { AiCard } from './AiCard';
import { DetectionReportCard } from './DetectionReportCard';
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
  /** How many unreviewed auto suggestions exist, and a way to delete them all. */
  pending?: number;
  onClearSuggestions?: () => void;
  /** For the AI check: the suggestions, the video file in the player, and a reload. */
  suggested: VEvent[];
  /** Saved tags, to measure the detection runs against. */
  confirmed: VEvent[];
  fileUrl: () => string | null;
  reload: () => Promise<unknown>;
}

/**
 * First pass, run on the phone: finds ball contacts (sound), edit cuts
 * (picture), rallies, and optionally jersey numbers and court sides. Results
 * land in Review. Runs as a background job with a notification.
 */
export function AutoPanel({ match, players, video, onCalibrate, onCalibration, getTime, onDone, pending = 0, onClearSuggestions, suggested, confirmed, fileUrl, reload }: Props) {
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
  // Set when the detection finished and every rally should get the AI check first.
  const [aiRun, setAiRun] = useState<{ done: () => void } | null>(null);
  const report = <DetectionReportCard match={match} players={players} confirmed={confirmed} />;
  const aiCard = <AiCard match={match} players={players} suggested={suggested} fileUrl={fileUrl} localUri={video?.uri ?? null} reload={reload} autoRun={aiRun} />;

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
        if (first) return;
        if (aiPrefs.afterDetect() && (fileUrl() || video)) reload().then(() => setAiRun({ done: () => { setAiRun(null); done.current(); } }));
        else done.current();
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
        {aiCard}
        {report}
        {pending > 0 && onClearSuggestions && (
          <button className="btn-ghost small danger wide" onClick={() => {
            if (confirm(`Delete all ${pending} unreviewed auto suggestion${pending === 1 ? '' : 's'}? Saved touches are kept.`)) onClearSuggestions();
          }}>🗑 Delete {pending} unreviewed suggestion{pending === 1 ? '' : 's'}</button>
        )}
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
    <div className="pad auto-panel">
      {a && (
        <div className="job">
          <div className="progress"><div style={{ width: `${Math.round(Math.max(0.02, a.progress) * 100)}%` }} /></div>
          <span className="small">{label(a, u)}</span>
          {running && <button className="btn-ghost small" onClick={() => Native.cancelAnalysis({ matchId: match.id })}>Cancel</button>}
        </div>
      )}

      <p className="small muted">
        The phone finds the touches in the video (sound, picture, jersey numbers) in the background. The suggestions land
        in <b>Review</b>.
      </p>

      <div className={`auto-step ${video ? 'done' : ''}`}>
        <b>1 · Video</b>
        <span className="small">{video ? '✓ Loaded on this phone' : 'Load the match video on this phone first (pick a file or import a link).'}</span>
      </div>

      <div className={`auto-step ${match.calibration ? 'done' : ''}`}>
        <b>2 · Court &amp; sides <small className="muted">(recommended)</small></b>
        <span className="small muted">Tells our touches from theirs, places players on the court and numbers the sets.</span>
        <div className="row wrap calib-status">
          {match.calibration
            ? <SidesPanel calibration={match.calibration} getTime={getTime} onChange={onCalibration} onMark={onCalibrate} />
            : <button className="btn small" onClick={() => onCalibrate(null)}>Mark the court (4+ points)</button>}
        </div>
      </div>

      <details className="auto-step">
        <summary><b>3 · Options</b> <small className="muted">jerseys {readJerseys ? 'on' : 'off'} · {detectCuts ? 'edited video' : 'uncut'} · sensitivity {sensitivity.toFixed(1)}×</small></summary>
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
      </details>

      {aiCard}
      {report}

      <button className="btn btn-primary wide" disabled={!video || running} onClick={run}>
        {running ? 'Analysing…' : '✨ Run auto-detection'}
      </button>
      {err && <p className="error small">{err}</p>}
      <p className="muted small">
        A new run replaces the suggestions you have not saved yet; saved touches are kept and not suggested again.
        Progress is saved, so an app update or a reboot does not start it over. Offline results upload once you are back online.
      </p>
      {pending > 0 && onClearSuggestions && (
        <button className="btn-ghost small danger wide" disabled={running} onClick={() => {
          if (confirm(`Delete all ${pending} unreviewed auto suggestion${pending === 1 ? '' : 's'}? Saved touches are kept. Then run again, e.g. at sensitivity 0.7.`)) onClearSuggestions();
        }}>🗑 Delete {pending} unreviewed suggestion{pending === 1 ? '' : 's'}</button>
      )}
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
