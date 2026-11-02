import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EventEditor } from '../components/EventEditor';
import { EventList, playerLabel } from '../components/EventList';
import { ReviewPanel } from '../components/ReviewPanel';
import { RallyReview } from '../components/RallyReview';
import { LineupSheet } from '../components/LineupSheet';
import { DEFAULT_TAG_SETTINGS, fmtTime, isTyping, TagPad, type TagSettings } from '../components/TagPad';
import { AutoPanel } from '../components/AutoPanel';
import { CalibrationOverlay, CalibrationPanel, useCalibration } from '../components/Calibration';
import { VideoPlayer, type PlayerHandle } from '../components/VideoPlayer';
import { VideoSource } from '../components/VideoSource';
import { VideoClock } from '../components/VideoClock';
import { actionLabel, scoreOf } from '../lib/actions';
import { outcome } from '../lib/rallyReview';
import { zoneOf } from '../lib/court';
import { MatchSheetScan } from '../components/MatchSheetScan';
import { MoreMenu } from '../components/MoreMenu';
import { EditsPanel } from '../components/EditsPanel';
import { FrameStep, SpeedControl } from '../components/SpeedControl';
import { QualityControl } from '../components/QualityControl';
import { ReadNumbers } from '../components/ReadNumbers';
import { Timeline } from '../components/Timeline';
import { available, loadQuality, saveQuality, urlFor, type Quality, type VideoLink } from '../lib/videoQuality';
import { lineupsFromSheet } from '../lib/sheetFlow';
import { checkAgainstSheet } from '../lib/sheetCheck';
import { OPP_POINT_VALUE, TheyScored, type TheyScoredResult } from '../components/TheyScored';
import { api, ApiError, serverBase, type Match, type MatchBundle, type MatchVersion, type EditSuggestion, type VideoJob, type Player, type VEvent } from '../lib/api';
import { isApp, localVideo, Native, playableUrl, setLocalVideo, type LocalVideo, type WorkState } from '../lib/native';
import { scoreBySet } from '../lib/stats';
import { useEvents } from '../lib/useEvents';
import { pointsOfSet, rotationAfter } from '../lib/rotation';
import { ourHalfAt, type Calibration } from '../lib/calibration';
import { useWorkTimer } from '../lib/useWorkTimer';

type Tab = 'tag' | 'events' | 'review' | 'ai' | 'edits';


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
  // The video in the team's storage, streamed when it is not on this device.
  const [cloudLink, setCloudLink] = useState<VideoLink | null>(null);
  const [cloudTry, setCloudTry] = useState(0);
  const [cloudFresh, setCloudFresh] = useState(0);
  // The size to stream (the original by default here; 720p / 480p once the server made them).
  const [quality, setQuality] = useState<Quality>(() => loadQuality('coach', 'original'));
  useEffect(() => {
    if (isLive || local || !match.video_key) { setCloudLink(null); return; }
    api.videoUrl(match.id).then(setCloudLink).catch(() => {});
  }, [isLive, !!local, match.video_key, cloudTry, cloudFresh]);
  const cloud = cloudLink ? urlFor(cloudLink, quality) : null;
  const cloudUrl = cloud?.url ?? null;
  const source = useMemo(() => {
    if (isLive) return null;
    if (local) return { type: 'file' as const, url: isApp() ? playableUrl(local.uri) : local.uri };
    if (cloudUrl) return { type: 'file' as const, url: cloudUrl, remote: true, group: `match-${match.id}` };
    if (match.video_type === 'youtube' && match.video_ref) return { type: 'youtube' as const, id: match.video_ref };
    return null;
  }, [isLive, local, cloudUrl, match.video_type, match.video_ref]);

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

  // Desktop keyboard transport (the tag pad handles players and actions itself; ? shows all keys).
  const [showKeys, setShowKeys] = useState(false);
  const keyState = useRef({ events, rate, remove, flash: (_: string) => {} });
  keyState.current = { events, rate, remove, flash: (text: string) => flash(text) };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const p = player.current;
      const k = keyState.current;
      const tagTimes = () => k.events.filter((x) => x.status === 'confirmed' && x.t != null).map((x) => x.t!).sort((a, b) => a - b);
      switch (e.key) {
        case ' ': e.preventDefault(); p?.toggle(); break;
        case 'ArrowLeft': e.preventDefault(); p?.seekBy(e.shiftKey ? -10 : -2); break;
        case 'ArrowRight': e.preventDefault(); p?.seekBy(e.shiftKey ? 10 : 2); break;
        case 'ArrowUp': e.preventDefault(); p?.seekBy(60); break;
        case 'ArrowDown': e.preventDefault(); p?.seekBy(-60); break;
        case ',': p?.pause(); p?.seekBy(-1 / 30); break;
        case '.': p?.pause(); p?.seekBy(1 / 30); break;
        case ']': { const now = (p?.time() ?? 0) + 0.5; const n = tagTimes().find((t) => t > now); if (n != null) p?.seek(Math.max(0, n - 3)); break; }
        case '[': { const now = (p?.time() ?? 0) - 3.5; const prev = tagTimes().filter((t) => t < now).pop(); if (prev != null) p?.seek(Math.max(0, prev - 3)); break; }
        case 'm': case 'M': {
          const slow = Number(localStorage.getItem('viq:slowRate')) || 0.25;
          const r = k.rate < 1 ? 1 : slow;
          setRate(r); p?.setRate(r);
          break;
        }
        case 'Backspace': {
          const last = lastAdded(k.events);
          if (last) { e.preventDefault(); k.remove(last); k.flash(`Removed ${actionLabel(last)}`); }
          break;
        }
        case '?': setShowKeys((v) => !v); break;
        case 'Escape': setShowKeys(false); break;
        default: break;
      }
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

  // Corrections sent from the public link's Replays tab, waiting for a decision.
  const [edits, setEdits] = useState<EditSuggestion[]>([]);
  const [editBusy, setEditBusy] = useState<number | null>(null);
  useEffect(() => { api.edits(match.id).then(setEdits).catch(() => {}); }, [match.id]);
  async function decideEdit(s: EditSuggestion, decision: 'accept' | 'reject') {
    setEditBusy(s.id);
    try {
      await api.decideEdit(s.id, decision);
      setEdits((l) => l.filter((x) => x.id !== s.id));
      if (decision === 'accept') { await reload(); flash('Correction applied'); }
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setEditBusy(null);
    }
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

  // Move selected events to another set (e.g. 6 points accidentally tagged in the
  // wrong set), keeping their timestamps and everything else. Undoable.
  async function moveEventsToSet(list: VEvent[], setNo: number) {
    const originals = list.map((e) => ({ e, set: e.set_no }));
    for (const e of list) await update(e, { set_no: setNo });
    flash(`Moved ${list.length} event${list.length === 1 ? '' : 's'} to set ${setNo}`, async () => {
      for (const { e, set } of originals) await update(e, { set_no: set });
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
  const setTags = confirmed.filter((e) => (e.set_no ?? 1) === setNo && e.action !== 'block_miss');
  const lastPoint = setTags.map((e) => !!scoreOf(e)).lastIndexOf(true);
  const rallyTags = setTags.slice(lastPoint + 1);
  const lastTag = rallyTags[rallyTags.length - 1] ?? null;
  const server = rotationNow?.weServe ? players.find((p) => p.id === rotationNow.positions[0]) ?? null : null;

  /** A pass graded 0 is not a point by itself (it can be rescued): ask whether it was their ace. */
  const zeroPass = lastTag?.action === 'receive' && lastTag.value === 0 ? lastTag : null;

  const [theyOpen, setTheyOpen] = useState(false);
  const lostError = (() => {
    const o = outcome(lastTag ? { id: lastTag.id, action: lastTag.action } : null, true, false);
    return o.change && lastTag ? `${actionLabel({ action: o.change.action, value: o.change.value ?? lastTag.value })}${playerLabel(players, lastTag) ? ` by ${playerLabel(players, lastTag)}` : ''}` : null;
  })();

  /** "They won", told how: our error (the last tag), or their attack / ace / block with where it landed. */
  function theyScored(r: TheyScoredResult) {
    setTheyOpen(false);
    const t = getTime();
    const time = t == null ? null : t;
    if (r.kind === 'error') return settle(false, true);
    if (r.kind === 'block' && lastTag && (lastTag.action === 'attack' || lastTag.action === 'kill')) {
      const before = { action: lastTag.action };
      update(lastTag, { action: 'attack_blocked' });
      return flash(`Lost: ${actionLabel({ action: 'attack_blocked', value: null })}`, () => update(lastTag, before));
    }
    const spot = r.at ? { fx: r.at.x, fy: r.at.y, zone: zoneOf(r.at) } : {};
    // Blockers who jumped without touching it: where the ball went past them (just before the rally's end).
    for (const id of r.noTouch ?? []) {
      commit({ action: 'block_miss', player_id: id, t: time == null ? null : Math.max(0, time - 0.3), ...(r.at ? { x: r.at.x, y: r.at.y } : {}) });
    }
    if (r.playerId != null && r.kind === 'attack') return commit({ action: 'dig_error', player_id: r.playerId, t: time, ...spot });
    if (r.kind === 'ace' && lastTag?.action === 'receive') {
      // The pass is already tagged: it becomes a 0, and their ace is added after it.
      if (lastTag.value !== 0) update(lastTag, { value: 0 });
      return commit({ action: 'opp_point', value: OPP_POINT_VALUE.ace, t: time });
    }
    if (r.playerId != null && r.kind === 'ace') {
      commit({ action: 'receive', value: 0, player_id: r.playerId, t: time, ...spot });
      return commit({ action: 'opp_point', value: OPP_POINT_VALUE.ace, t: time == null ? null : time + 0.05 });
    }
    commit({ action: 'opp_point', value: OPP_POINT_VALUE[r.kind] ?? null, t: time, ...(r.at ? { x: r.at.x, y: r.at.y } : {}) });
  }

  function settle(won: boolean, asError = false) {
    if (!won && !asError) { player.current?.pause(); return setTheyOpen(true); }
    const o = outcome(lastTag ? { id: lastTag.id, action: lastTag.action } : null, true, won);
    if (o.change && lastTag) {
      const before = { action: lastTag.action, value: lastTag.value };
      update(lastTag, { action: o.change.action, ...(o.change.value !== undefined ? { value: o.change.value } : {}) });
      if (!o.add) flash(`${won ? 'Point' : 'Lost'}: ${actionLabel({ action: o.change.action, value: o.change.value ?? lastTag.value })}`, () => update(lastTag, before));
    }
    if (o.add) {
      const t = getTime();
      commit({ action: o.add, value: o.addValue ?? null, t: t == null ? null : t });
    }
  }
  const outcomeLabel = (won: boolean) => {
    if (!won) return 'how?';
    const o = outcome(lastTag ? { id: lastTag.id, action: lastTag.action } : null, true, won);
    return o.change ? actionLabel({ action: o.change.action, value: o.change.value ?? null }) : o.add === 'opp_error' ? 'their error' : 'their point';
  };

  const pad = (
    <TagPad
      players={players}
      settings={settings}
      getTime={getTime}
      pause={() => player.current?.pause()}
      play={() => player.current?.play()}
      isPlaying={() => !!player.current?.isPlaying()}
      // "+1 Opp. point" asks how they scored, like "They won".
      onCommit={(e) => (e.action === 'opp_point' && e.value == null ? (player.current?.pause(), setTheyOpen(true)) : commit(e))}
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
          <small className="muted">{match.team_name ?? 'No team'}{pendingCount ? ` · ${pendingCount} offline` : ''}</small>
        </div>
        <div className="scorebox">
          <button className="set-btn" onClick={() => setSetNo((s) => Math.max(1, s - 1))}>‹</button>
          <span className="set-no">S{setNo}</span>
          <button className="set-btn" onClick={() => setSetNo((s) => Math.min(5, s + 1))}>›</button>
          <span className="score">{score.us}<i>:</i>{score.them}</span>
        </div>
        <button className="btn-ghost" onClick={() => setShowSettings(true)} aria-label="Settings"><Icon name="gear" /></button>
        <MoreMenu />
      </header>

      <div className="ws-body">
        {!isLive && (
          <section className="ws-video">
            {source ? (
              <>
                <div className="video-wrap">
                  <VideoPlayer ref={player} source={source} onStateChange={setPlaying}
                    onError={() => { if (cloudUrl && cloudTry < 1) setCloudTry((n) => n + 1); }} />
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
                <>
                <Timeline player={player} events={events} />
                <div className="transport">
                  <button onClick={() => player.current?.seekBy(-10)}>−10</button>
                  <button onClick={() => player.current?.seekBy(-2)}>−2</button>
                  <button className="tp-main" onClick={() => player.current?.toggle()}>{playing ? '❚❚' : '▶'}</button>
                  <button onClick={() => player.current?.seekBy(2)}>+2</button>
                  <button onClick={() => player.current?.seekBy(10)}>+10</button>
                  <div className="tp-row2">
                    <SpeedControl className="tp-rate" rate={rate} youtube={source?.type === 'youtube'} onRate={(r) => { setRate(r); player.current?.setRate(r); }} />
                    {source?.type === 'file' && <FrameStep player={player} />}
                    <button className="tp-keys" onClick={() => setShowKeys(true)} title="Keyboard shortcuts">Keys ?</button>
                    {cloud && <QualityControl className="tp-rate" quality={cloud.quality} options={available(cloudLink)}
                      onPick={(q) => { setQuality(q); saveQuality('coach', q); }} />}
                  </div>
                </div>
                </>
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
            {!isLive && <button className={`tab ${tab === 'ai' ? 'on' : ''}`} onClick={() => setTab('ai')}>Auto</button>}
            {(edits.length > 0 || tab === 'edits') && (
              <button className={`tab ${tab === 'edits' ? 'on' : ''}`} onClick={() => setTab('edits')} title="Corrections sent from the public link">
                ✎ Edits {edits.length > 0 && <small className="dot">{edits.length}</small>}
              </button>
            )}
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
                {zeroPass && (
                  <div className="zero-pass small">
                    <span>Pass 0 by {playerLabel(players, zeroPass) || '?'}: was it their ace?</span>
                    <button className="btn small btn-lost" onClick={() => { const t = getTime(); commit({ action: 'opp_point', value: OPP_POINT_VALUE.ace, t: t == null ? null : t }); }}>Their ace (point)</button>
                    <span className="muted">Kept in play? Just tag on.</span>
                  </div>
                )}
                {theyOpen && (
                  <TheyScored errorLabel={lostError} players={players} onCourt={onCourt}
                    flip={!!match.calibration && ourHalfAt(match.calibration, getTime() ?? 0) === 'far'}
                    onDone={theyScored} onCancel={() => setTheyOpen(false)} />
                )}
                <div className="outcome-bar">
                  <button className="btn btn-won" onClick={() => settle(true)}>We won <small>{outcomeLabel(true)}</small></button>
                  <button className="btn btn-lost" onClick={() => settle(false)}>They won <small>{outcomeLabel(false)}</small></button>
                </div>
                {confirmed.length > 0 && (() => {
                  const last = lastAdded(confirmed)!;
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
            {tab === 'edits' && (
              <EditsPanel edits={edits} players={players} busy={editBusy} onDecide={decideEdit}
                onWatch={(t) => { if (!source) return flash('Load the video first'); player.current?.seek(Math.max(0, t - 3)); player.current?.play(); }} />
            )}
            {tab === 'events' && (
              <div className="row wrap">
                <SheetBox match={match} players={players} events={events} onSaved={setMatch} onSeek={(t) => player.current?.seek(t)} onEdit={setEditing} />
                <VersionsBox match={match} pending={pendingCount} onRestored={reload} />
                <CloudVideoBox match={match} local={local} onChanged={async () => setMatch((await api.match(match.id)).match)}
                  onConverted={() => setCloudFresh((n) => n + 1)} />
              </div>
            )}
            {tab === 'events' && (
              <EventList events={confirmed} players={players} onSeek={(t) => player.current?.seek(t)} onEdit={setEditing} onDeleteMany={deleteEvents} onSetMany={moveEventsToSet} filterable playlistTeam={match.team_id}
                onPlayAll={source ? (list) => setReel({ list, i: 0 }) : undefined} />
            )}
            {tab === 'review' && (
              suggested.length === 0 && !(reviewing && reviewMode === 'rally') ? (
                <div className="pad">
                  <p className="muted">No AI suggestions to review. Run <b>Auto</b> to detect touches from the video automatically.</p>
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
            {tab === 'ai' && (
              <AutoPanel
                match={match}
                players={players}
                video={isApp() ? local : null}
                onLocal={(v) => { setLocalVideo(match.id, v); setLocal(v); }}
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
                pending={suggested.length}
                suggested={suggested}
                confirmed={confirmed}
                fileUrl={() => player.current?.fileUrl() ?? null}
                reload={reload}
                onClearSuggestions={async () => {
                  const n = suggested.length;
                  try { await api.clearSuggestions(match.id); } catch { /* fall back below */ }
                  await reload();
                  flash(`Deleted ${n} unreviewed suggestion${n === 1 ? '' : 's'}`);
                }}
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

      {showKeys && <KeyHelp onClose={() => setShowKeys(false)} />}
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
            {!isLive && source?.type === 'file' && (
              <details className="auto-step">
                <summary><b>Roster from the video</b> <small className="muted">read the shirt numbers with AI</small></summary>
                <ReadNumbers player={player} teamId={match.team_id} teamName={match.team_name ?? 'the team'} players={players} onAdded={reload} />
              </details>
            )}
            <label className="field-label">Timestamp lead (reaction time): {settings.leadSeconds}s</label>
            <input type="range" min={0} max={3} step={0.5} value={settings.leadSeconds} onChange={(e) => setSettings({ ...settings, leadSeconds: Number(e.target.value) })} />
            {!isLive && source && (
              <button className="btn wide" onClick={() => {
                player.current?.pause();
                setShowSettings(false);
                player.current?.resetZoom();
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

/**
 * The official match sheet for a match already being tagged: its match flow (points
 * per rotation, serve turns) is kept with the match, and its starting six fill in
 * line-ups for sets that have none yet.
 */
function SheetBox({ match, players, events, onSaved, onSeek, onEdit }: {
  match: Match; players: Player[]; events: VEvent[]; onSaved: (m: Match) => void; onSeek: (t: number) => void; onEdit: (e: VEvent) => void;
}) {
  const [open, setOpen] = useState<'scan' | 'check' | null>(null);
  const flow = match.sheet;
  const checks = useMemo(() => (open === 'check' && flow ? checkAgainstSheet(events, flow, players) : []), [open, flow, events, players]);
  // The other team letter fitting the tags much better = ours was picked wrong when attaching.
  const swapped = useMemo(() => {
    if (open !== 'check' || !flow) return false;
    const n = (l: ReturnType<typeof checkAgainstSheet>) => l.reduce((a, c) => a + c.diffs.length + Math.abs(c.tagged.us - c.sheet.us) + Math.abs(c.tagged.them - c.sheet.them), 0);
    return n(checkAgainstSheet(events, { ...flow, ourTeam: flow.ourTeam === 'A' ? 'B' : 'A' }, players)) * 2 < n(checks);
  }, [open, flow, events, checks]);
  if (!open) {
    return (
      <>
        <button className="btn-ghost small" onClick={() => setOpen('scan')}>
          Match sheet{flow ? `: ${flow.flow.length} set${flow.flow.length === 1 ? '' : 's'} kept` : ' (read the match flow)'}
        </button>
        {flow && <button className="btn-ghost small" onClick={() => setOpen('check')}>✓ Check tags against the sheet</button>}
      </>
    );
  }
  const sc = (s: { us: number; them: number }) => `${s.us}:${s.them}`;
  const jump = (e: VEvent | null) => e && e.t != null && (
    <button className="btn-ghost small" onClick={() => onSeek(e.t!)}>▶ {fmtTime(e.t)}</button>
  );
  return (
    <div className="card wide">
      <div className="row between"><b>{open === 'check' ? 'Tags vs. match sheet' : 'Match sheet'}</b><button className="btn-ghost small" onClick={() => setOpen(null)}>Close</button></div>
      {open === 'check' && (
        checks.length === 0 ? <p className="small muted">No set has both tags and a match sheet entry yet.</p> : (
          <div className="sheet-check">
            <p className="small muted">Scores are ours:theirs. Each tagged point is matched to the sheet by who won it (and who served); what is left over is listed here.</p>
            {swapped && flow && (
              <p className="small tone-bad">The tags fit much better if we are team {flow.ourTeam === 'A' ? 'B' : 'A'} on the sheet.{' '}
                <button className="btn small" onClick={async () => onSaved(await api.updateMatch(match.id, { sheet: { ...flow, ourTeam: flow.ourTeam === 'A' ? 'B' : 'A' } }))}>Switch to team {flow.ourTeam === 'A' ? 'B' : 'A'}</button>
              </p>
            )}
            {checks.map((c) => (
              <div key={c.set} className="sheet-check-set">
                <b>Set {c.set}</b> · tags {sc(c.tagged)} · sheet {sc(c.sheet)}{' '}
                {c.diffs.length === 0 ? <span className="tone-good">✓ every point matches</span>
                  : <span className="tone-bad">{c.diffs.length} difference{c.diffs.length === 1 ? '' : 's'}</span>}
                {!c.sheetOk && (
                  <div className="small muted sheet-issues">
                    The scanned sheet does not add up exactly here, probably a misread cell (check it on the paper sheet). The points are still compared; a difference right next to one of these may come from the scan:
                    <ul>{c.issues.map((x, k) => <li key={k}>{x.text}</li>)}</ul>
                  </div>
                )}
                {c.diffs.length > 8 && <p className="small muted">This many differences usually means the tags and the sheet do not belong to the same set (set number or team switched). The first 8:</p>}
                <ul>
                  {c.diffs.slice(0, 8).map((d, k) => (
                    <li key={k}>
                      {d.kind === 'extra' && <>Point for {d.tagged.winner === 'us' ? 'us' : 'them'} tagged that is not on the sheet (sheet at {sc(d.sheetScore)}{d.ctx ? `, ${d.ctx}` : ''}) {jump(d.tagged.end)}<button className="btn-ghost small" onClick={() => onEdit(d.tagged.end)}>Edit tag</button></>}
                      {d.kind === 'missing' && <>Point for {d.sheet.winner === 'us' ? 'us' : 'them'} at {sc(d.sheetScore)} on the sheet ({d.sheet.ctx}) is not tagged{d.after ? <>, after the rally at {jump(d.after.end)}</> : ' (start of the set)'}</>}
                      {d.kind === 'wrong' && <>Tagged for {d.tagged.winner === 'us' ? 'us' : 'them'}, the sheet gives it to {d.sheet.winner === 'us' ? 'us' : 'them'} (at {sc(d.sheetScore)}, {d.sheet.ctx}) {jump(d.tagged.end)}<button className="btn-ghost small" onClick={() => onEdit(d.tagged.end)}>Edit tag</button></>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      )}
      {open === 'scan' && (
        <>
          {flow && (
            <p className="small muted">
              Kept: {flow.flow.length} set{flow.flow.length === 1 ? '' : 's'} (we are team {flow.ourTeam}).{' '}
              <button className="link" onClick={async () => onSaved(await api.updateMatch(match.id, { sheet: null }))}>Remove</button>
            </p>
          )}
          <MatchSheetScan onTeamCreated={() => {}} onAttach={async (f, liberoNo) => {
            const lineups = { ...lineupsFromSheet(f, players, liberoNo), ...(match.lineups ?? {}) };
            onSaved(await api.updateMatch(match.id, { sheet: f, ...(Object.keys(lineups).length ? { lineups } : {}) }));
            setOpen(null);
          }} />
        </>
      )}
    </div>
  );
}

/**
 * Saved versions of this match (on the server, so the app and the website see the same
 * list): save one as a checkpoint, go back to one later. Restoring first saves the
 * current state as its own version, so a restore can be undone too.
 */
/**
 * The match video in the team's storage: upload it from the phone (in the background,
 * so teammates can watch the replays without their own copy), or delete it.
 */
function CloudVideoBox({ match, local, onChanged, onConverted }: { match: Match; local: LocalVideo | null; onChanged: () => Promise<void>; onConverted: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [job, setJob] = useState<WorkState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.videoEnabled().then((x) => setEnabled(x.enabled)).catch(() => setEnabled(false)); }, []);
  // Follow the upload job while this is open (it runs on without the app).
  useEffect(() => {
    if (!enabled || !isApp()) return;
    let live = true, was: string | null = null;
    const tick = async () => {
      const w = (await Native.videoUploadStatus({ matchId: match.id }).catch(() => null))?.work ?? null;
      if (!live) return;
      setJob(w);
      if (w?.state === 'succeeded' && was && was !== 'succeeded') await onChanged();
      was = w?.state ?? null;
    };
    tick();
    const t = window.setInterval(tick, 2000);
    return () => { live = false; clearInterval(t); };
  }, [enabled, match.id]);
  if (enabled === null) return null;
  if (!enabled) {
    return (
      <div className="card cloud-video">
        <b>Team video</b>
        <span className="small muted">Not set up on the server yet: add the S3_ lines for your storage bucket to the server's .env and update it (see the README). Then the video can be uploaded here once for the whole team.</span>
      </div>
    );
  }
  const running = !!job && ['enqueued', 'running', 'blocked'].includes(job.state);
  const gb = (b: number | null | undefined) => (b ? `${(b / 1073741824).toFixed(b > 1073741824 * 10 ? 0 : 1)} GB` : '');
  return (
    <div className="card cloud-video">
      <b>Team video</b>
      {match.video_key ? (
        <>
          <span className="small">✓ In your storage{match.video_bytes ? ` · ${gb(match.video_bytes)}` : ''}. The team watches it in Replays without their own copy.</span>
          <ConversionStatus matchId={match.id} videoKey={match.video_key} onDone={onConverted} />
          <button className="btn-ghost small danger" disabled={busy} onClick={async () => {
            if (!confirm('Delete the video from your storage? Replays then need everyone\'s own copy again.')) return;
            setBusy(true);
            try { await api.deleteVideo(match.id); await onChanged(); } finally { setBusy(false); }
          }}>Delete from storage</button>
        </>
      ) : running ? (
        <>
          <div className="progress"><div style={{ width: `${Math.round(Math.max(0.02, job!.progress) * 100)}%` }} /></div>
          <span className="small">{job!.message ?? 'Uploading…'} · goes on in the background</span>
          <button className="btn-ghost small" onClick={() => Native.cancelVideoUpload({ matchId: match.id })}>Stop</button>
        </>
      ) : isApp() && local ? (
        <>
          <span className="small muted">Upload the video once, so the team can watch the replays without their own copy. It goes straight to your storage, in the background.</span>
          {job?.state === 'failed' && <span className="small error">Last try: {job.error}</span>}
          <button className="btn" onClick={async () => {
            await Native.requestNotifications().catch(() => {});
            await Native.uploadVideo({ matchId: match.id, uri: local.uri, apiBase: serverBase(), token: api.token() });
            setJob({ id: '', state: 'enqueued', progress: 0, message: 'Starting…' });
          }}>Upload for the team</button>
        </>
      ) : (
        <span className="small muted">Upload it from the Android app on the phone with the video.</span>
      )}
    </div>
  );
}

/** The server's 720p and 480p versions of the team video: waiting, in progress, ready or failed. */
function ConversionStatus({ matchId, videoKey, onDone }: { matchId: number; videoKey: string; onDone: () => void }) {
  const [job, setJob] = useState<VideoJob | null | undefined>(undefined);
  const [hours, setHours] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [poll, setPoll] = useState(0);
  useEffect(() => {
    // Asks again every few seconds only while the server is still at it.
    let live = true, was: string | undefined, t: number | undefined;
    const tick = async () => {
      const r = await api.videoStatus(matchId).catch(() => null);
      const j = r?.job;
      if (!live || j === undefined) return;
      setJob(j);
      setHours(r?.hours ?? null);
      if (j?.state === 'done' && was && was !== 'done') onDone();
      was = j?.state;
      if (j && (j.state === 'queued' || j.state === 'running' || j.state === 'paused')) t = window.setTimeout(tick, j.state === 'paused' ? 60000 : 5000);
    };
    tick();
    return () => { live = false; clearTimeout(t); };
  }, [matchId, videoKey, poll]);
  if (job === undefined) return null;
  const convert = async () => {
    setBusy(true);
    try { await api.convertVideo(matchId); setPoll((n) => n + 1); } finally { setBusy(false); }
  };
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  if (!job) {
    return (
      <span className="small muted">No smaller versions for a weak connection yet.{' '}
        <button className="link" disabled={busy} onClick={convert}>Make 720p and 480p versions</button></span>
    );
  }
  const night = hours ? ` The server converts between ${hours.replace('-', ':00 and ')}:00.` : '';
  if (job.state === 'queued') return <span className="small muted">720p and 480p versions: waiting for the server{job.ahead ? ` (${job.ahead} video${job.ahead === 1 ? '' : 's'} first)` : ''}.{night}</span>;
  if (job.state === 'paused') {
    return (
      <>
        <div className="progress"><div style={{ width: pct(Math.max(0.02, job.progress)) }} /></div>
        <span className="small muted">720p and 480p versions: {pct(job.progress)}, paused until tonight.{night}</span>
      </>
    );
  }
  if (job.state === 'running') {
    return (
      <>
        <div className="progress"><div style={{ width: pct(Math.max(0.02, job.progress)) }} /></div>
        <span className="small muted">Making 720p and 480p versions on the server: {pct(job.progress)}</span>
      </>
    );
  }
  if (job.state === 'failed') {
    return <span className="small error">The 720p and 480p versions could not be made: {job.error}{' '}
      <button className="link" disabled={busy} onClick={convert}>Try again</button></span>;
  }
  return <span className="small muted">720p and 480p versions ready: pick the size under the video.</span>;
}

function VersionsBox({ match, pending, onRestored }: { match: Match; pending: number; onRestored: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<MatchVersion[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) api.versions(match.id).then(setList).catch((e) => setError(String(e.message ?? e))); }, [open, match.id]);
  if (!open) return <button className="btn-ghost small" onClick={() => setOpen(true)}>Versions</button>;
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await f(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  const when = (s: string) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="card wide">
      <div className="row between"><b>Saved versions</b><button className="btn-ghost small" onClick={() => setOpen(false)}>Close</button></div>
      <p className="small muted">A version keeps every tag of this match, the line-ups, the court marking and the match sheet. Going back to one replaces the current tags (they are saved as a version first, so you can return to them).</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { setList(await api.saveVersion(match.id, label)); setLabel(''); }); }}>
        <input className="input grow" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. Original tagging" maxLength={80} />
        <button className="btn btn-primary" disabled={busy}>Save version</button>
      </form>
      {error && <p className="error small">{error}</p>}
      {pending > 0 && <p className="small muted">{pending} change{pending === 1 ? '' : 's'} still waiting to upload: going back to a version is possible once they are synced.</p>}
      {list && (list.length === 0 ? <p className="small muted">No saved versions yet.</p> : (
        <ul className="list">
          {list.map((v) => (
            <li key={v.id} className="list-item">
              <span className="grow"><b>{v.label}</b><small className="muted"> · {when(v.created_at)} · {v.event_count} tags{v.auto ? ' · saved automatically' : ''}</small></span>
              <button className="btn small" disabled={busy || pending > 0} onClick={() => {
                if (!confirm(`Go back to "${v.label}"? The current tags are saved as a version first.`)) return;
                run(async () => { const r = await api.restoreVersion(match.id, v.id); setList(r.versions); await onRestored(); });
              }}>Go back</button>
              <button className="btn-ghost small" disabled={busy} onClick={() => {
                if (!confirm(`Delete the version "${v.label}"?`)) return;
                run(async () => setList(await api.deleteVersion(match.id, v.id)));
              }}>Delete</button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/** All the keyboard shortcuts of the match page (desktop). */
function KeyHelp({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Space', 'Play / pause'],
    ['← →', '2 s back / forward (with Shift: 10 s)'],
    ['↑ ↓', '1 minute forward / back'],
    [', .', 'One frame back / forward'],
    ['[ ]', 'Previous / next tag'],
    ['M', 'Slow motion on / off'],
    ['1 – 99', 'Pick the player by shirt number (e.g. 1 then 2 = #12)'],
    ['-', 'Unknown player'],
    ['Q W E C R', 'Errors: attack, serve, dig, blocked, block'],
    ['A S D B F H', 'Attack, serve, dig, free ball, block touch, block without touch'],
    ['Z X V', 'Kill, ace, block point'],
    ['G T Y U', 'Set, bump set, bump set error, set error'],
    ['0 – 3', 'Pass grade (after picking the player)'],
    ['1 – 6', 'Zone (when asked for a spot), Enter = skip'],
    ['Esc', 'Cancel the tag'],
    ['Backspace', 'Undo the last tag'],
    ['W L N', 'Rally review: we won, they won, not a rally'],
    ['?', 'This list'],
  ];
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet key-help" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>Keyboard shortcuts</b><button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <table className="small">
          <tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The tag added last (not the last one in the video): tags waiting to upload are the newest
 * (their temporary ids count down from -1), otherwise the highest id.
 */
function lastAdded(events: VEvent[]): VEvent | undefined {
  const list = events.filter((x) => x.status === 'confirmed');
  const pending = list.filter((x) => x.id < 0);
  if (pending.length) return pending.reduce((a, b) => (b.id < a.id ? b : a));
  return list.reduce<VEvent | undefined>((a, b) => (!a || b.id > a.id ? b : a), undefined);
}
