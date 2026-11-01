import { useEffect, useRef, useState } from 'react';
import { api, serverBase, type DetectorTuning, type Match, type Player, type VEvent } from '../lib/api';
import { aiPrefs } from '../lib/aiCheck';
import { AiCard } from './AiCard';
import { DetectionReportCard } from './DetectionReportCard';
import { flatPoints, segments, type Calibration } from '../lib/calibration';
import { SidesPanel } from './Calibration';
import { isApp, Native, type LocalVideo, type WorkState } from '../lib/native';
import { useImport } from './VideoSource';

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
  /** The match's YouTube video, downloaded to the phone. */
  onLocal?: (v: LocalVideo) => void;
}

/**
 * First pass, run on the phone: finds ball contacts (sound), edit cuts
 * (picture), rallies, and optionally jersey numbers and court sides. Results
 * land in Review. Runs as a background job with a notification.
 */
export function AutoPanel({ match, players, video, onCalibrate, onCalibration, getTime, onDone, pending = 0, onClearSuggestions, suggested, confirmed, fileUrl, reload, onLocal }: Props) {
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
          }}>Delete {pending} unreviewed suggestion{pending === 1 ? '' : 's'}</button>
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
        // The thresholds learned from the tagged matches (the defaults until there are enough).
        ...((await api.detector().catch(() => null))?.use ?? {}),
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
        {!video && isApp() && match.video_type === 'youtube' && match.video_ref && onLocal && <DownloadYoutube match={match} onLocal={onLocal} />}
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
      <LearnedDetector />
      {report}

      <button className="btn btn-primary wide" disabled={!video || running} onClick={run}>
        {running ? 'Analysing…' : 'Run auto-detection'}
      </button>
      {err && <p className="error small">{err}</p>}
      <p className="muted small">
        A new run replaces the suggestions you have not saved yet; saved touches are kept and not suggested again.
        Progress is saved, so an app update or a reboot does not start it over. Offline results upload once you are back online.
      </p>
      {pending > 0 && onClearSuggestions && (
        <button className="btn-ghost small danger wide" disabled={running} onClick={() => {
          if (confirm(`Delete all ${pending} unreviewed auto suggestion${pending === 1 ? '' : 's'}? Saved touches are kept. Then run again, e.g. at sensitivity 0.7.`)) onClearSuggestions();
        }}>Delete {pending} unreviewed suggestion{pending === 1 ? '' : 's'}</button>
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

/**
 * What the detection learned from the tagged matches: each run keeps every sound peak, so the
 * server tries other thresholds against the tags and the next run uses the best ones.
 */
function LearnedDetector() {
  const [d, setD] = useState<DetectorTuning | null>(null);
  const load = () => api.detector().then(setD).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!d) return null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const better = d.ready && d.best && d.best.score > d.baseline.score;
  return (
    <details className="auto-step learned">
      <summary><b>Learning from your tags</b> <small className="muted">{
        !d.ready ? `${d.touches} of ${150} tagged touches to start` : d.off ? 'switched off' : better ? `hears ${pct(d.best!.recall)} of touches (was ${pct(d.baseline.recall)})` : 'the standard settings are best so far'
      }</small></summary>
      <p className="small muted">
        Each run keeps every sound it heard, also the faint ones it did not count. VolleyIQ then checks against the touches you tagged
        which settings would have heard the most of them with the least noise between rallies, and the next run uses those.
        Tag one or two sets of a match by hand before running the detection on it: each tagged set teaches it more.
      </p>
      {!d.ready ? (
        <p className="small">So far {d.touches} tagged touch{d.touches === 1 ? '' : 'es'} in {d.matches} match{d.matches === 1 ? '' : 'es'} with a run. Learning starts at 150 (about four sets).</p>
      ) : (
        <table className="small detection-table">
          <thead><tr><th /><th>Touches heard</th><th>Noise between rallies</th><th>Settings</th></tr></thead>
          <tbody>
            <tr><td>Standard</td><td>{pct(d.baseline.recall)}</td><td>{d.baseline.noisePerMin.toFixed(1)} / min</td><td>{d.baseline.threshold} · {d.baseline.sustainMax}</td></tr>
            {d.best && <tr><td>Learned</td><td><b>{pct(d.best.recall)}</b></td><td><b>{d.best.noisePerMin.toFixed(1)} / min</b></td><td>{d.best.threshold} · {d.best.sustainMax}</td></tr>}
          </tbody>
        </table>
      )}
      {d.ready && <p className="small muted">From {d.touches} tagged touches in {d.matches} match{d.matches === 1 ? '' : 'es'}. The sensitivity slider still works on top of it.</p>}
      {d.ready && better && (
        <label className="toggle small">
          <input type="checkbox" checked={!d.off} onChange={async (e) => { await api.setDetectorOff(!e.target.checked); load(); }} /> Use the learned settings
        </label>
      )}
    </details>
  );
}

/** The YouTube video of the match, downloaded to the phone (the tagging so far keeps its times). */
function DownloadYoutube({ match, onLocal }: { match: Match; onLocal: (v: LocalVideo) => void }) {
  const imp = useImport(match.id, onLocal);
  const [err, setErr] = useState('');
  if (imp.running) {
    return (
      <div className="job">
        <div className="progress"><div style={{ width: `${Math.max(2, Math.round((imp.work?.progress ?? 0) * 100))}%` }} /></div>
        <span className="small">{imp.work?.message ?? 'Starting download…'} · goes on in the background <button className="btn-ghost small" onClick={imp.cancel}>Cancel</button></span>
      </div>
    );
  }
  return (
    <>
      <span className="small muted">The video plays from YouTube. Detection needs the file on the phone: download it once (on Wi-Fi; a full match is 1 to 3 GB).</span>
      <button className="btn" onClick={() => imp.start(`https://www.youtube.com/watch?v=${match.video_ref}`).catch((e) => setErr((e as Error).message))}>Download the YouTube video</button>
      {err && <span className="small error">{err}</span>}
    </>
  );
}
