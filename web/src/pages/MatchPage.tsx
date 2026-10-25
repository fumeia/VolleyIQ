import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EventEditor } from '../components/EventEditor';
import { EventList, playerLabel } from '../components/EventList';
import { ReviewPanel } from '../components/ReviewPanel';
import { RallyReview } from '../components/RallyReview';
import { LineupSheet } from '../components/LineupSheet';
import { StatsView } from '../components/StatsView';
import { MatchReportView } from '../report/ReportViews';
import { DEFAULT_TAG_SETTINGS, fmtTime, TagPad, type TagSettings } from '../components/TagPad';
import { AutoPanel } from '../components/AutoPanel';
import { CalibrationOverlay, CalibrationPanel, useCalibration } from '../components/Calibration';
import { VideoPlayer, type PlayerHandle } from '../components/VideoPlayer';
import { VideoSource } from '../components/VideoSource';
import { VideoClock } from '../components/VideoClock';
import { ACTION_BY_CODE, actionLabel } from '../lib/actions';
import { outcome } from '../lib/rallyReview';
import { api, ApiError, publicBase, type Match, type MatchBundle, type VEvent } from '../lib/api';
import { isApp, localVideo, playableUrl, setLocalVideo, type LocalVideo } from '../lib/native';
import { exportEventsCsv, exportPlayersCsv } from '../lib/csv';
import { scoreBySet } from '../lib/stats';
import { useEvents } from '../lib/useEvents';
import { pointsOfSet, rotationAfter } from '../lib/rotation';
import { ourHalfAt, type Calibration } from '../lib/calibration';
import { useWorkTimer } from '../lib/useWorkTimer';

type Tab = 'tag' | 'events' | 'review' | 'stats' | 'ai';


function loadSettings(): TagSettings {
  try {
    const { askZone: _old, ...saved } = JSON.parse(localStorage.getItem('viq:tagSettings') ?? '{}');
    return { ...DEFAULT_TAG_SETTINGS, ...saved };
  } catch {
    return DEFAULT_TAG_SETTINGS;
  }
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
  useWorkTimer(match.id);
  const [tab, setTab] = useState<Tab>(initial.events.some((e) => e.status === 'suggested') ? 'review' : 'tag');
  const [settings, setSettings] = useState<TagSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [statsView, setStatsView] = useState<'stats' | 'images'>('stats');
  // Clip reel: the filtered events, each from 3 s before to 2 s after.
  const [reel, setReel] = useState<{ list: VEvent[]; i: number } | null>(null);
  useEffect(() => {
    if (!reel) return;
    const e = reel.list[reel.i];
    if (!e || e.t == null) { setReel(null); return; }
    player.current?.seek(Math.max(0, e.t - 3));
    player.current?.play();
    const timer = window.setTimeout(() => setReel((r) => (r && r.i + 1 < r.list.length ? { ...r, i: r.i + 1 } : null)), (5 / rate) * 1000);
    return () => clearTimeout(timer);
  }, [reel?.i, reel?.list]);
  const [lineupSet, setLineupSet] = useState<number | null>(null);
  const [reviewMode, setReviewMode] = useState<'rally' | 'touch'>(() => (localStorage.getItem('viq:reviewMode') === 'touch' ? 'touch' : 'rally'));
  useEffect(() => { try { localStorage.setItem('viq:reviewMode', reviewMode); } catch { /* private mode */ } }, [reviewMode]);
  const [editing, setEditing] = useState<VEvent | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  // A video file on this device (phone gallery, imported link, or a browser file).
  const [local, setLocal] = useState<LocalVideo | null>(() => (isApp() ? localVideo(initial.match.id) : null));
  const [calibrating, setCalibrating] = useState(false);
  // Marking the court from this video time on (a later set, camera moved); null = the first marking.
  const [calibFrom, setCalibFrom] = useState<number | null>(null);
  const calib = useCalibration(initial.match.calibration);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [setNo, setSetNo] = useState(() => Math.max(1, ...initial.events.map((e) => e.set_no ?? 1)));
  const player = useRef<PlayerHandle>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const isLive = match.mode === 'live';
  const source = useMemo(() => {
    if (isLive) return null;
    if (local) return { type: 'file' as const, url: isApp() ? playableUrl(local.uri) : local.uri };
    if (match.video_type === 'youtube' && match.video_ref) return { type: 'youtube' as const, id: match.video_ref };
    return null;
  }, [isLive, local, match.video_type, match.video_ref]);

  const suggested = events.filter((e) => e.status === 'suggested');
  // Keep the rally review open after its last rally, so its Undo stays reachable.
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { if (tab === 'review' && suggested.length > 0) setReviewing(true); }, [tab, suggested.length > 0]);
  const confirmed = events.filter((e) => e.status === 'confirmed');
  const score = scoreBySet(confirmed).find((s) => s.set === setNo) ?? { us: 0, them: 0 };
  // A set is over at 25 (15 in the fifth) with a two-point lead.
  const setOver = Math.max(score.us, score.them) >= (setNo === 5 ? 15 : 25) && Math.abs(score.us - score.them) >= 2;

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

  // Line-up of the current set, rotated by the points tagged so far: on-court players come first.
  const lineup = match.lineups?.[String(setNo)];
  const rotationNow = lineup ? rotationAfter(lineup, pointsOfSet(confirmed, setNo, Infinity), players, getTime() ?? Infinity) : null;
  const onCourt = rotationNow
    ? [4, 3, 2, 5, 6, 1].map((pos) => rotationNow.positions[pos - 1]).filter((x): x is number => x != null)
    : undefined;

  /** Deletes saved events; Undo puts them back. */
  async function deleteEvents(list: VEvent[]) {
    const copies = list.filter((e) => e.id > 0).map(({ id: _id, client_id: _c, ...rest }) => rest);
    await removeSuggestions(list);
    flash(`Deleted ${list.length} event${list.length === 1 ? '' : 's'}`, async () => {
      for (const e of copies) await api.addEvent(match.id, e);
      await reload();
    });
  }

  async function removeSuggestions(list: VEvent[]) {
    // Big clean-ups go to the server in one request; small ones stay optimistic.
    if (list.length > 5 && list.every((e) => e.id > 0)) {
      try {
        await api.bulkEvents(match.id, 'delete', list.map((e) => e.id));
        await reload();
        return;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 0) throw err;
        // Offline: delete one by one, which queues them until the connection is back.
      }
    }
    await Promise.all(list.map((e) => remove(e)));
  }

  // Tags since the last point of this set = the rally being tagged.
  const setTags = confirmed.filter((e) => (e.set_no ?? 1) === setNo);
  const lastPoint = setTags.map((e) => !!ACTION_BY_CODE[e.action]?.score).lastIndexOf(true);
  const rallyTags = setTags.slice(lastPoint + 1);
  const lastTag = rallyTags[rallyTags.length - 1] ?? null;
  const server = rotationNow?.weServe ? players.find((p) => p.id === rotationNow.positions[0]) ?? null : null;

  /** "We won" / "They won" for the rally just tagged: the last tag becomes the point or the error. */
  function settle(won: boolean) {
    const o = outcome(lastTag ? { id: lastTag.id, action: lastTag.action } : null, true, won);
    if (o.change && lastTag) {
      const before = { action: lastTag.action, value: lastTag.value };
      update(lastTag, { action: o.change.action, ...(o.change.value !== undefined ? { value: o.change.value } : {}) });
      flash(`${won ? 'Point' : 'Lost'}: ${actionLabel({ action: o.change.action, value: o.change.value ?? lastTag.value })}`, () => update(lastTag, before));
    } else if (o.add) {
      const t = getTime();
      commit({ action: o.add, t: t == null ? null : t });
    }
  }
  const outcomeLabel = (won: boolean) => {
    const o = outcome(lastTag ? { id: lastTag.id, action: lastTag.action } : null, true, won);
    return o.add ? (o.add === 'opp_error' ? 'their error' : 'their point') : actionLabel({ action: o.change!.action, value: o.change!.value ?? null });
  };

  const pad = (
    <TagPad
      players={players}
      settings={settings}
      getTime={getTime}
      pause={() => player.current?.pause()}
      play={() => player.current?.play()}
      isPlaying={() => !!player.current?.isPlaying()}
      onCommit={commit}
      onCourt={onCourt}
      server={server}
      lastAction={lastTag?.action ?? null}
      farAt={(t) => !!match.calibration && ourHalfAt(match.calibration, t ?? getTime() ?? 0) === 'far'}
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
                <div className="video-wrap">
                  <VideoPlayer ref={player} source={source} onStateChange={setPlaying} />
                  <VideoClock player={player} />
                  {calibrating && <CalibrationOverlay session={calib} aspect={player.current?.aspect() ?? 16 / 9} />}
                </div>
                {calibrating ? (
                  <CalibrationPanel
                    session={calib}
                    from={calibFrom}
                    onCancel={() => setCalibrating(false)}
                    onSave={async (c) => {
                      const cur = match.calibration;
                      const next: Calibration = calibFrom == null || !cur
                        ? { ...cur, ...c, corners: undefined }
                        : { ...cur, switches: [...(cur.switches ?? []).filter((s) => Math.abs(s.t - calibFrom) > 1), { t: calibFrom, ...c }] };
                      setMatch(await api.updateMatch(match.id, { calibration: next }));
                      setCalibrating(false);
                      flash(calibFrom == null ? 'Court calibrated' : `Court re-marked from ${fmtTime(calibFrom)}`);
                    }}
                  />
                ) : tab === 'review' && reviewMode === 'rally' && suggested.length > 0 ? null : (
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
                )}
              </>
            ) : (
              <>
                {match.video_type === 'local' && !local && (
                  <p className="notice card small">This match's video ({match.video_ref}) is on another device. Load it here to watch and tag.</p>
                )}
                <VideoSource match={match} onLocal={setLocal} onMatch={setMatch} />
              </>
            )}
          </section>
        )}

        <section className="ws-panel">
          <nav className="tabs ws-tabs">
            <button className={`tab ${tab === 'tag' ? 'on' : ''}`} onClick={() => setTab('tag')}>Tag</button>
            {!isLive && (
              <button className={`tab ${tab === 'review' ? 'on' : ''}`} onClick={() => setTab('review')}>
                Review {suggested.length > 0 && <small className="dot">{suggested.length}</small>}
              </button>
            )}
            <button className={`tab ${tab === 'events' ? 'on' : ''}`} onClick={() => setTab('events')}>Events <small>{confirmed.length}</small></button>
            <button className={`tab ${tab === 'stats' ? 'on' : ''}`} onClick={() => setTab('stats')}>Stats</button>
            {!isLive && <button className={`tab ${tab === 'ai' ? 'on' : ''}`} onClick={() => setTab('ai')}>Auto</button>}
          </nav>

          <div className="ws-content">
            {tab === 'tag' && (
              <>
                {setOver && setNo < 5 && (
                  <div className="set-over">
                    <span>Set {setNo} {score.us > score.them ? 'won' : 'lost'} {score.us}:{score.them}</span>
                    <button className="btn btn-primary small" onClick={() => setSetNo(setNo + 1)}>Start set {setNo + 1} ›</button>
                  </div>
                )}
                {pad}
                <div className="outcome-bar">
                  <button className="btn btn-won" onClick={() => settle(true)}>We won <small>{outcomeLabel(true)}</small></button>
                  <button className="btn btn-lost" onClick={() => settle(false)}>They won <small>{outcomeLabel(false)}</small></button>
                </div>
                {confirmed.length > 0 && (() => {
                  const last = confirmed[confirmed.length - 1];
                  return (
                    <button className="btn-ghost small" onClick={() => { remove(last); flash(`Removed ${actionLabel(last)}`); }}>
                      ↶ Undo last tag ({playerLabel(players, last)} {actionLabel(last)})
                    </button>
                  );
                })()}
                <h3 className="section-title">Last tags</h3>
                <EventList events={confirmed} players={players} limit={5} onSeek={(t) => player.current?.seek(t)} onEdit={setEditing} />
              </>
            )}
            {reel && (
              <div className="reel-bar">
                <span>▶ Clip {reel.i + 1}/{reel.list.length} · {playerLabel(players, reel.list[reel.i])} {actionLabel(reel.list[reel.i])}</span>
                <button className="btn-ghost small" disabled={reel.i === 0} onClick={() => setReel({ ...reel, i: reel.i - 1 })}>◀</button>
                <button className="btn-ghost small" disabled={reel.i + 1 >= reel.list.length} onClick={() => setReel({ ...reel, i: reel.i + 1 })}>▶</button>
                <button className="btn-ghost small" onClick={() => { setReel(null); player.current?.pause(); }}>Stop</button>
              </div>
            )}
            {tab === 'events' && (
              <EventList events={confirmed} players={players} onSeek={(t) => player.current?.seek(t)} onEdit={setEditing} onDeleteMany={deleteEvents} filterable
                onPlayAll={source ? (list) => setReel({ list, i: 0 }) : undefined} />
            )}
            {tab === 'review' && (
              suggested.length === 0 && !(reviewing && reviewMode === 'rally') ? (
                <div className="pad">
                  <p className="muted">No AI suggestions to review. Run <b>Auto ✨</b> to detect touches from the video automatically.</p>
                  <button className="btn wide" onClick={() => setTab('ai')}>Open auto-detection</button>
                </div>
              ) : reviewMode === 'rally' ? (
                <RallyReview
                  match={match}
                  suggested={suggested}
                  confirmed={confirmed}
                  players={players}
                  spots={{ location: settings.location, scope: settings.spotScope }}
                  player={player}
                  update={update}
                  add={(e) => add(e)}
                  removeMany={removeSuggestions}
                  removeByClient={(cid) => { const ev = eventsRef.current.find((x) => x.client_id === cid); if (ev) remove(ev); }}
                  reload={reload}
                  onTouchView={() => setReviewMode('touch')}
                  onLineup={(n) => setLineupSet(n)}
                  onExit={() => setTab('tag')}
                />
              ) : (
                <ReviewPanel
                  events={suggested}
                  players={players}
                  player={player}
                  update={update}
                  remove={remove}
                  removeMany={removeSuggestions}
                  onEdit={setEditing}
                  onRallyView={() => setReviewMode('rally')}
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
                <div className="segmented">
                  <button className={statsView === 'stats' ? 'on' : ''} onClick={() => setStatsView('stats')}>Stats &amp; charts</button>
                  <button className={statsView === 'images' ? 'on' : ''} onClick={() => setStatsView('images')}>📤 Share images</button>
                </div>
                {statsView === 'stats' ? (
                  <>
                    <StatsView players={players} events={events} matches={[match]} />
                    <div className="row wrap">
                      <button className="btn" onClick={() => exportEventsCsv(match, players, events)}>⬇ Events CSV</button>
                      <button className="btn" onClick={() => exportPlayersCsv(match, players, events)}>⬇ Player CSV</button>
                      <ShareButton match={match} onChange={setMatch} />
                    </div>
                  </>
                ) : (
                  <MatchReportView match={match} players={players} events={events}
                    actions={<ShareButton match={match} onChange={setMatch} />} />
                )}
              </>
            )}
            {tab === 'ai' && (
              <AutoPanel
                match={match}
                players={players}
                video={isApp() ? local : null}
                getTime={getTime}
                onCalibration={async (c) => setMatch(await api.updateMatch(match.id, { calibration: c }))}
                onCalibrate={(from) => {
                  if (!source) return flash('Load the video first');
                  player.current?.pause();
                  const cur = match.calibration;
                  // Start from the marking in use at that time: after a small camera move most points are still close.
                  const prev = from == null ? cur?.points
                    : [...(cur?.switches ?? [])].filter((s) => s.t <= from && s.points).sort((a, b) => b.t - a.t)[0]?.points ?? cur?.points;
                  calib.load(prev ?? []);
                  setCalibFrom(from);
                  setCalibrating(true);
                  window.scrollTo({ top: 0 });
                }}
                onDone={async () => { await reload(); setTab('review'); }}
              />
            )}
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

      {lineupSet != null && (
        <LineupSheet match={match} players={players} initialSet={lineupSet} getTime={getTime} onClose={() => setLineupSet(null)}
          onSave={async (lineups) => { setMatch(await api.updateMatch(match.id, { lineups })); flash('Line-up saved'); }} />
      )}

      {showSettings && (
        <div className="sheet-backdrop" onClick={() => setShowSettings(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><b>Tagging settings</b><button className="btn-ghost" onClick={() => setShowSettings(false)}>✕</button></div>
            <label className="toggle"><input type="checkbox" checked={settings.autoPause} onChange={(e) => setSettings({ ...settings, autoPause: e.target.checked })} /> Pause video while tagging, resume afterwards</label>
            <label className="field-label">Court spots (serves, passes, sets, attacks, digs, blocks)</label>
            <div className="segmented">
              {(['points', 'zones', 'off'] as const).map((m) => (
                <button key={m} className={settings.location === m ? 'on' : ''} onClick={() => setSettings({ ...settings, location: m })}>
                  {m === 'points' ? 'Tap exact spot' : m === 'zones' ? 'Zone 1–6' : 'Skip'}
                </button>
              ))}
            </div>
            {settings.location !== 'off' && (
              <div className="segmented">
                <button className={settings.spotScope !== 'key' ? 'on' : ''} onClick={() => setSettings({ ...settings, spotScope: 'all' })}>All actions</button>
                <button className={settings.spotScope === 'key' ? 'on' : ''} onClick={() => setSettings({ ...settings, spotScope: 'key' })}>Fast: serve, pass, attack</button>
              </div>
            )}
            {settings.location === 'points' && (
              <label className="toggle"><input type="checkbox" checked={settings.fromTap} onChange={(e) => setSettings({ ...settings, fromTap: e.target.checked })} /> Also tap where the ball was played from (2 taps)</label>
            )}
            <label className="field-label">Receive</label>
            <div className="segmented">
              <button className={settings.receiveMode === 'court' ? 'on' : ''} onClick={() => setSettings({ ...settings, receiveMode: 'court' })}>Tap where pass landed</button>
              <button className={settings.receiveMode === 'grade' ? 'on' : ''} onClick={() => setSettings({ ...settings, receiveMode: 'grade' })}>Grade 0–3</button>
            </div>
            <button className="btn wide" onClick={() => { setShowSettings(false); setLineupSet(setNo); }}>
              Line-up for set {setNo}{lineup ? ' ✓' : ''} (on-court players first)
            </button>
            <label className="field-label">Timestamp lead (reaction time): {settings.leadSeconds}s</label>
            <input type="range" min={0} max={3} step={0.5} value={settings.leadSeconds} onChange={(e) => setSettings({ ...settings, leadSeconds: Number(e.target.value) })} />
            {!isLive && source && (
              <button className="btn wide" onClick={() => {
                player.current?.pause();
                setShowSettings(false);
                calib.load(match.calibration?.points ?? []);
                setCalibFrom(null);
                setCalibrating(true);
              }}>
                {match.calibration ? 'Recalibrate court' : 'Calibrate court (tap 4+ court points)'}
              </button>
            )}
            {!isLive && source && (
              <button className="btn wide" onClick={() => {
                setLocalVideo(match.id, null);
                setLocal(null);
                setMatch({ ...match, video_type: null, video_ref: null });
                setShowSettings(false);
              }}>
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

function ShareButton({ match, onChange }: { match: Match; onChange: (m: Match) => void }) {
  const url = match.share_token ? `${publicBase()}/s/${match.share_token}` : null;
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

