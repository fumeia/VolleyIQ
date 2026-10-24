import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EventEditor } from '../components/EventEditor';
import { EventList } from '../components/EventList';
import { ReviewPanel } from '../components/ReviewPanel';
import { StatsView } from '../components/StatsView';
import { TagPad, type TagSettings } from '../components/TagPad';
import { parseYouTubeId, VideoPlayer, type PlayerHandle } from '../components/VideoPlayer';
import { actionLabel } from '../lib/actions';
import { api, type Job, type Match, type MatchBundle, type VEvent } from '../lib/api';
import { exportEventsCsv, exportPlayersCsv } from '../lib/csv';
import { scoreBySet } from '../lib/stats';
import { useEvents } from '../lib/useEvents';

type Tab = 'tag' | 'events' | 'review' | 'stats' | 'ai';

const DEFAULT_SETTINGS: TagSettings = { autoPause: true, askZone: true, leadSeconds: 1 };

function loadSettings(): TagSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('viq:tagSettings') ?? '{}') }; } catch { return DEFAULT_SETTINGS; }
}

export function MatchPage() {
  const id = Number(useParams().id);
  const [bundle, setBundle] = useState<MatchBundle | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.match(id).then(setBundle).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!bundle) return <p className="muted">Loading…</p>;
  return <MatchWorkspace key={id} initial={bundle} />;
}

function MatchWorkspace({ initial }: { initial: MatchBundle }) {
  const nav = useNavigate();
  const [match, setMatch] = useState<Match>(initial.match);
  const players = initial.players;
  const { events, add, update, remove, replaceAll, pendingCount } = useEvents(match.id, initial.events);
  const [tab, setTab] = useState<Tab>(initial.events.some((e) => e.status === 'suggested') ? 'review' : 'tag');
  const [settings, setSettings] = useState<TagSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [editing, setEditing] = useState<VEvent | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [setNo, setSetNo] = useState(() => Math.max(1, ...initial.events.map((e) => e.set_no ?? 1)));
  const player = useRef<PlayerHandle>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const isLive = match.mode === 'live';
  const source = useMemo(() => {
    if (isLive) return null;
    if (localUrl) return { type: 'file' as const, url: localUrl };
    if (match.video_type === 'youtube' && match.video_ref) return { type: 'youtube' as const, id: match.video_ref };
    if (match.video_type === 'upload' && match.video_ref) return { type: 'file' as const, url: `/media/${match.video_ref}` };
    return null;
  }, [isLive, localUrl, match.video_type, match.video_ref]);

  const suggested = events.filter((e) => e.status === 'suggested');
  const confirmed = events.filter((e) => e.status === 'confirmed');
  const score = scoreBySet(confirmed).find((s) => s.set === setNo) ?? { us: 0, them: 0 };

  useEffect(() => { localStorage.setItem('viq:tagSettings', JSON.stringify(settings)); }, [settings]);

  // Keep the phone screen awake while tagging.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav_ = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const request = () => nav_.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    request();
    const onVis = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); };
  }, []);

  // Desktop keyboard transport (the tag pad handles action keys itself).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); player.current?.toggle(); }
      if (e.key === 'ArrowLeft') player.current?.seekBy(e.shiftKey ? -10 : -2);
      if (e.key === 'ArrowRight') player.current?.seekBy(e.shiftKey ? 10 : 2);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const flash = useCallback((text: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const eventsRef = useRef(events);
  eventsRef.current = events;

  function commit(e: Partial<VEvent>) {
    const clientId = add({ ...e, set_no: setNo });
    const p = players.find((x) => x.id === e.player_id);
    const who = p ? `#${p.number} ` : '';
    flash(`${who}${actionLabel(e as VEvent)}${e.zone ? ` · Z${e.zone}` : ''}`, () => {
      const ev = eventsRef.current.find((x) => x.client_id === clientId);
      if (ev) remove(ev);
    });
    navigator.vibrate?.(15);
  }

  async function reload() {
    const b = await api.match(match.id);
    setMatch(b.match);
    replaceAll(b.events);
    return b;
  }

  const getTime = () => player.current?.time() ?? null;

  const pad = (
    <TagPad
      players={players}
      settings={settings}
      getTime={getTime}
      pause={() => player.current?.pause()}
      play={() => player.current?.play()}
      isPlaying={() => !!player.current?.isPlaying()}
      onCommit={commit}
    />
  );

  return (
    <div className={`workspace ${isLive ? 'is-live' : ''}`}>
      <header className="ws-head">
        <Link to="/" className="btn-ghost" aria-label="Back">‹</Link>
        <div className="ws-title">
          <b>{match.label}</b>
          <small className="muted">{match.team_name ?? 'No team'}{pendingCount ? ` · ⏳ ${pendingCount} offline` : ''}</small>
        </div>
        <div className="scorebox">
          <button className="set-btn" onClick={() => setSetNo((s) => Math.max(1, s - 1))}>‹</button>
          <span className="set-no">S{setNo}</span>
          <button className="set-btn" onClick={() => setSetNo((s) => Math.min(5, s + 1))}>›</button>
          <span className="score">{score.us}<i>:</i>{score.them}</span>
        </div>
        <button className="btn-ghost" onClick={() => setShowSettings(true)} aria-label="Settings">⚙</button>
      </header>

      <div className="ws-body">
        {!isLive && (
          <section className="ws-video">
            {source ? (
              <>
                <VideoPlayer ref={player} source={source} onStateChange={setPlaying} />
                <div className="transport">
                  <button onClick={() => player.current?.seekBy(-10)}>−10</button>
                  <button onClick={() => player.current?.seekBy(-2)}>−2</button>
                  <button className="tp-main" onClick={() => player.current?.toggle()}>{playing ? '❚❚' : '▶'}</button>
                  <button onClick={() => player.current?.seekBy(2)}>+2</button>
                  <button onClick={() => player.current?.seekBy(10)}>+10</button>
                  <button className="tp-rate" onClick={() => {
                    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : rate === 2 ? 0.5 : 1;
                    setRate(next);
                    player.current?.setRate(next);
                  }}>{rate}×</button>
                </div>
              </>
            ) : (
              <VideoSource match={match} onLocal={setLocalUrl} onMatch={setMatch} />
            )}
          </section>
        )}

        <section className="ws-panel">
          <nav className="tabs ws-tabs">
            <button className={`tab ${tab === 'tag' ? 'on' : ''}`} onClick={() => setTab('tag')}>Tag</button>
            <button className={`tab ${tab === 'events' ? 'on' : ''}`} onClick={() => setTab('events')}>Events <small>{confirmed.length}</small></button>
            {!isLive && (
              <button className={`tab ${tab === 'review' ? 'on' : ''}`} onClick={() => setTab('review')}>
                Review {suggested.length > 0 && <small className="dot">{suggested.length}</small>}
              </button>
            )}
            <button className={`tab ${tab === 'stats' ? 'on' : ''}`} onClick={() => setTab('stats')}>Stats</button>
            {!isLive && <button className={`tab ${tab === 'ai' ? 'on' : ''}`} onClick={() => setTab('ai')}>Auto ✨</button>}
          </nav>

          <div className="ws-content">
            {tab === 'tag' && (
              <>
                {pad}
                <h3 className="section-title">Last tags</h3>
                <EventList events={confirmed} players={players} limit={5} onSeek={(t) => player.current?.seek(t)} onEdit={setEditing} />
              </>
            )}
            {tab === 'events' && (
              <EventList events={confirmed} players={players} onSeek={(t) => player.current?.seek(t)} onEdit={setEditing} />
            )}
            {tab === 'review' && (
              suggested.length === 0 ? (
                <div className="pad">
                  <p className="muted">No AI suggestions to review. Run <b>Auto ✨</b> to detect touches from the video automatically.</p>
                  <button className="btn wide" onClick={() => setTab('ai')}>Open auto-detection</button>
                </div>
              ) : (
                <ReviewPanel
                  events={suggested}
                  players={players}
                  player={player}
                  update={update}
                  remove={remove}
                  onEdit={setEditing}
                  onExit={() => setTab('tag')}
                  confirmAll={async () => {
                    await api.bulkEvents(match.id, 'confirm', suggested.filter((e) => e.id > 0).map((e) => e.id));
                    reload();
                  }}
                />
              )
            )}
            {tab === 'stats' && (
              <>
                <StatsView players={players} events={events} />
                <div className="row wrap">
                  <button className="btn" onClick={() => exportEventsCsv(match, players, events)}>⬇ Events CSV</button>
                  <button className="btn" onClick={() => exportPlayersCsv(match, players, events)}>⬇ Player CSV</button>
                  <ShareButton match={match} onChange={setMatch} />
                </div>
              </>
            )}
            {tab === 'ai' && <AutoPanel match={match} hasLocal={!!localUrl} onMatch={setMatch} onDone={async () => { await reload(); setTab('review'); }} />}
          </div>
        </section>
      </div>

      {toast && (
        <div className="toast">
          <span>✓ {toast.text}</span>
          {toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>}
        </div>
      )}

      {editing && (
        <EventEditor
          event={editing}
          players={players}
          getTime={source ? getTime : undefined}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await update(editing, patch); setEditing(null); }}
          onDelete={async () => { await remove(editing); setEditing(null); }}
        />
      )}

      {showSettings && (
        <div className="sheet-backdrop" onClick={() => setShowSettings(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><b>Tagging settings</b><button className="btn-ghost" onClick={() => setShowSettings(false)}>✕</button></div>
            <label className="toggle"><input type="checkbox" checked={settings.autoPause} onChange={(e) => setSettings({ ...settings, autoPause: e.target.checked })} /> Pause video while tagging, resume afterwards</label>
            <label className="toggle"><input type="checkbox" checked={settings.askZone} onChange={(e) => setSettings({ ...settings, askZone: e.target.checked })} /> Ask for zone on attacks and serves</label>
            <label className="field-label">Timestamp lead (reaction time): {settings.leadSeconds}s</label>
            <input type="range" min={0} max={3} step={0.5} value={settings.leadSeconds} onChange={(e) => setSettings({ ...settings, leadSeconds: Number(e.target.value) })} />
            {!isLive && source && (
              <button className="btn wide" onClick={() => { setLocalUrl(null); setMatch({ ...match, video_type: null, video_ref: null }); setShowSettings(false); }}>
                Change video
              </button>
            )}
            <button className="btn btn-danger wide" onClick={async () => {
              if (!confirm('Delete this match and all its tags?')) return;
              await api.deleteMatch(match.id);
              nav('/');
            }}>Delete match</button>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoSource({ match, onLocal, onMatch }: { match: Match; onLocal: (url: string) => void; onMatch: (m: Match) => void }) {
  const [yt, setYt] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="video-source card">
      <b>Load video</b>
      <div className="row">
        <input className="input" placeholder="YouTube URL or video ID" value={yt} onChange={(e) => setYt(e.target.value)} />
        <button className="btn btn-primary" onClick={async () => {
          const id = parseYouTubeId(yt);
          if (!id) return setErr('Not a valid YouTube link');
          onMatch(await api.updateMatch(match.id, { video_type: 'youtube', video_ref: id }));
        }}>Load</button>
      </div>
      <label className="btn wide file-btn">
        📁 Pick video from phone
        <input type="file" accept="video/*" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLocal(URL.createObjectURL(f));
        }} />
      </label>
      <p className="muted small">Phone videos play locally and are not uploaded. To use auto-detection, upload it in the <b>Auto ✨</b> tab or use a YouTube link.</p>
      {err && <p className="error small">{err}</p>}
    </div>
  );
}

function ShareButton({ match, onChange }: { match: Match; onChange: (m: Match) => void }) {
  const url = match.share_token ? `${location.origin}/s/${match.share_token}` : null;
  return url ? (
    <>
      <button className="btn" onClick={async () => {
        if (navigator.share) navigator.share({ title: match.label, url }).catch(() => {});
        else { await navigator.clipboard.writeText(url); alert('Link copied'); }
      }}>🔗 Share report</button>
      <button className="btn-ghost small" onClick={async () => onChange({ ...match, share_token: (await api.share(match.id, true)).share_token })}>Revoke link</button>
    </>
  ) : (
    <button className="btn" onClick={async () => onChange({ ...match, share_token: (await api.share(match.id)).share_token })}>🔗 Create share link</button>
  );
}

function AutoPanel({ match, hasLocal, onMatch, onDone }: { match: Match; hasLocal: boolean; onMatch: (m: Match) => void; onDone: () => void }) {
  const [job, setJob] = useState<Job | null>(null);
  const [upload, setUpload] = useState<number | null>(null);
  const [ocr, setOcr] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.match(match.id).then((b) => {
      const latest = b.jobs?.[0];
      if (latest) setJob(latest);
    });
  }, [match.id]);

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    const t = setInterval(async () => {
      const j = await api.job(job.id);
      setJob(j);
      if (j.status === 'done') onDone();
    }, 3000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  const canAnalyze = match.video_type === 'youtube' || match.video_type === 'upload';
  const running = job && (job.status === 'queued' || job.status === 'running');

  return (
    <div className="pad">
      <p>
        <b>Auto-detection</b> (first pass): the server finds rallies and ball contacts in the video, guesses the action
        (serve, receive, set, attack…) and tries to read jersey numbers. Everything lands in <b>Review</b> as a
        suggestion for you to confirm or correct with one tap.
      </p>
      {!canAnalyze && (
        <div className="card notice">
          {hasLocal
            ? 'This video only lives on your phone. Upload it so the server can analyse it:'
            : 'Load a YouTube link or upload a video first.'}
          <label className="btn wide file-btn">
            ⬆ Upload video {upload != null && `(${Math.round(upload * 100)}%)`}
            <input type="file" accept="video/*" hidden disabled={upload != null} onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUpload(0);
              setErr('');
              try { onMatch(await api.uploadVideo(match.id, f, setUpload)); } catch (x) { setErr((x as Error).message); }
              setUpload(null);
            }} />
          </label>
        </div>
      )}
      <label className="toggle"><input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} /> Read jersey numbers (slower)</label>
      <button className="btn btn-primary wide" disabled={!canAnalyze || !!running} onClick={async () => {
        setErr('');
        try { setJob(await api.analyze(match.id, { jersey_ocr: ocr })); } catch (x) { setErr((x as Error).message); }
      }}>
        {running ? 'Analysing…' : '✨ Run auto-detection'}
      </button>
      {job && (
        <div className="job">
          <div className="progress"><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
          <span className="small">{job.status} · {job.message ?? ''}</span>
        </div>
      )}
      {err && <p className="error small">{err}</p>}
      <p className="muted small">
        Re-running replaces earlier suggestions you have not confirmed yet. Confirmed tags are never touched.
        Detection is a helper, not a referee: expect to fix players and actions in the review pass.
      </p>
    </div>
  );
}
