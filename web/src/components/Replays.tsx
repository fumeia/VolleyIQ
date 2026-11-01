import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_BY_CODE, SKILLS } from '../lib/actions';
import type { Match, Player, VEvent } from '../lib/api';
import { ourHalfAt } from '../lib/calibration';
import { EditSheet } from './EditSheet';
import { fmtTime } from './TagPad';
import { VideoPlayer, type PlayerHandle } from './VideoPlayer';
import { FrameStep, SpeedControl } from './SpeedControl';
import { FolderOpen } from 'lucide-react';

interface Props {
  token: string;
  matches: Match[];
  players: Player[];
  events: VEvent[];
  /** The match picked elsewhere on the page, if any. */
  initialMatch: number | null;
}

/** Seconds of video before and after each tagged touch. */
const LEADS = [{ before: 3, after: 2, label: 'Short' }, { before: 6, after: 3, label: 'Long' }];

const sentKey = (token: string) => `viq:sentEdits:${token}`;
const loadSent = (token: string): number[] => { try { return JSON.parse(localStorage.getItem(sentKey(token)) ?? '[]'); } catch { return []; } };

/**
 * Replays on the public link: every tagged touch of a match as a clip, filtered by
 * skill, player and set. The video is the viewer's own copy, played on their device and
 * never uploaded (or the match's YouTube video). With corrections switched on, a viewer
 * who spots a wrong tag can send a correction; it is applied only when it is accepted
 * in the app.
 */
export function Replays({ token, matches, players, events, initialMatch }: Props) {
  const withTags = matches.filter((m) => events.some((e) => e.match_id === m.id && e.t != null));
  const [matchId, setMatchId] = useState<number | null>(initialMatch ?? withTags[withTags.length - 1]?.id ?? null);
  const match = matches.find((m) => m.id === matchId) ?? null;
  const [files, setFiles] = useState<Record<number, { url: string; name: string }>>({});
  const [skill, setSkill] = useState('all');
  const [result, setResult] = useState<'all' | 'points' | 'errors'>('all');
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [set, setSet] = useState<number | null>(null);
  const [lead, setLead] = useState(0);
  const [rate, setRate] = useState(1);
  const [cur, setCur] = useState<number | null>(null);
  const [playAll, setPlayAll] = useState(false);
  const [editing, setEditing] = useState(false);
  // The correction being made (a tag, or with [add] a touch that is not tagged, at that video time).
  const [target, setTarget] = useState<{ event: VEvent; add?: { matchId: number; t: number } } | null>(null);
  const [notice, setNotice] = useState('');
  const videoBox = useRef<HTMLDivElement>(null);
  const [sent, setSent] = useState<number[]>(() => loadSent(token));
  const player = useRef<PlayerHandle>(null);
  const stopAt = useRef<number | null>(null);

  const video = match?.video;
  const file = matchId != null ? files[matchId] : undefined;
  const source = video?.type === 'youtube' ? { type: 'youtube' as const, id: video.id } : file ? { type: 'file' as const, url: file.url } : null;

  const all = useMemo(() => events.filter((e) => e.match_id === matchId && e.t != null && ACTION_BY_CODE[e.action]?.group !== 'team')
    .sort((a, b) => a.t! - b.t!), [events, matchId]);
  const sets = [...new Set(all.map((e) => e.set_no ?? 1))].sort((a, b) => a - b);
  const inMatch = players.filter((p) => all.some((e) => e.player_id === p.id)).sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
  const clips = all.filter((e) => {
    const def = ACTION_BY_CODE[e.action];
    if (skill !== 'all' && !SKILLS.find((s) => s.label === skill)?.codes.includes(e.action)) return false;
    if (result === 'points' && def?.score !== 'us') return false;
    if (result === 'errors' && def?.score !== 'them') return false;
    if (playerId != null && e.player_id !== playerId) return false;
    if (set != null && (e.set_no ?? 1) !== set) return false;
    return true;
  });
  const idx = clips.findIndex((e) => e.id === cur);
  const current = idx >= 0 ? clips[idx] : null;

  function play(e: VEvent) {
    const p = player.current;
    setCur(e.id);
    if (!p) return;
    p.seek(Math.max(0, e.t! - LEADS[lead].before));
    p.setRate(rate);
    p.play();
    stopAt.current = e.t! + LEADS[lead].after;
  }

  // Stop at the end of the clip, or go on to the next one when playing all.
  const next = useRef<() => void>(() => {});
  next.current = () => {
    if (playAll && idx >= 0 && idx < clips.length - 1) play(clips[idx + 1]);
    else { player.current?.pause(); setPlayAll(false); }
  };
  useEffect(() => {
    const timer = window.setInterval(() => {
      const t = player.current?.time();
      if (t == null || stopAt.current == null || !player.current?.isPlaying()) return;
      if (t >= stopAt.current) { stopAt.current = null; next.current(); }
    }, 150);
    return () => clearInterval(timer);
  }, []);

  /** Up to the video, play the touch, and open its correction one question at a time. */
  function startEdit(e: VEvent) {
    setPlayAll(false);
    setNotice('');
    videoBox.current?.scrollIntoView({ block: 'start' });
    play(e);
    setTarget({ event: e });
  }
  function startAdd() {
    const t = player.current?.time();
    if (t == null || !match) return;
    player.current?.pause();
    setNotice('');
    videoBox.current?.scrollIntoView({ block: 'start' });
    const at = Math.round(t * 100) / 100;
    setTarget({
      add: { matchId: match.id, t: at },
      event: { id: -1, match_id: match.id, player_id: null, jersey: null, action: 'block_miss', value: null, zone: null, x: null, y: null, fx: null, fy: null, t: at, set_no: null, source: 'manual', status: 'confirmed', confidence: null },
    });
  }
  /** The moment around [t] again (for a touch being added). */
  function playAround(t: number) {
    const p = player.current;
    if (!p) return;
    p.seek(Math.max(0, t - LEADS[lead].before));
    p.setRate(rate);
    p.play();
    stopAt.current = t + 0.5;
  }

  function pickFile(f: File | undefined) {
    if (!f || matchId == null) return;
    setFiles((m) => ({ ...m, [matchId]: { url: URL.createObjectURL(f), name: f.name } }));
  }

  const who = (e: VEvent) => {
    const p = players.find((x) => x.id === e.player_id);
    return p ? `#${p.number ?? '–'} ${p.name.split(' ')[0]}` : e.jersey != null ? `#${e.jersey}` : 'Team';
  };

  if (!withTags.length) return <p className="muted">No tagged touches with video times yet.</p>;

  return (
    <div className="replays">
      <div className="row wrap">
        <select className="input" value={matchId ?? ''} onChange={(e) => { setMatchId(Number(e.target.value)); setCur(null); setSet(null); setPlayerId(null); }}>
          {[...withTags].reverse().map((m) => <option key={m.id} value={m.id}>{m.played_on ?? ''} {m.opponent ?? m.label}</option>)}
        </select>
      </div>

      <div className="replay-video" ref={videoBox}>
        {source ? <VideoPlayer ref={player} source={source} /> : (
          <label className="replay-pick">
            <input type="file" accept="video/*" onChange={(e) => pickFile(e.target.files?.[0])} />
            <b className="row"><FolderOpen /> Choose your copy of the match video</b>
            <span className="small muted">
              It plays here on your device and is not uploaded.{video?.type === 'file' ? <> The video file used for tagging is called <b>{video.name}</b>.</> : ''}
            </span>
          </label>
        )}
      </div>
      {file && <p className="small muted replay-file">▶ {file.name} · <label className="link">change<input type="file" accept="video/*" hidden onChange={(e) => pickFile(e.target.files?.[0])} /></label></p>}

      <div className="replay-filters">
        <div className="chips">
          {['all', ...SKILLS.map((s) => s.label)].map((s) => (
            <button key={s} className={`chip ${skill === s ? 'on' : ''}`} onClick={() => setSkill(s)}>{s === 'all' ? 'All' : s}</button>
          ))}
        </div>
        <div className="row wrap">
          <select className="input" value={playerId ?? ''} onChange={(e) => setPlayerId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All players</option>
            {inMatch.map((p) => <option key={p.id} value={p.id}>#{p.number ?? '–'} {p.name}</option>)}
          </select>
          <select className="input" value={set ?? ''} onChange={(e) => setSet(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All sets</option>
            {sets.map((s) => <option key={s} value={s}>Set {s}</option>)}
          </select>
          <div className="segmented replay-result">
            {(['all', 'points', 'errors'] as const).map((r) => (
              <button key={r} className={result === r ? 'on' : ''} onClick={() => setResult(r)}>{r === 'all' ? 'All' : r === 'points' ? 'Points' : 'Errors'}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="replay-bar">
        <button className="btn btn-primary" disabled={!source || !clips.length} onClick={() => { setPlayAll(true); play(current ?? clips[0]); }}>▶ Play all {clips.length}</button>
        <button className="btn" disabled={!source || idx <= 0} onClick={() => play(clips[idx - 1])}>◀</button>
        <button className="btn" disabled={!source || idx >= clips.length - 1} onClick={() => play(clips[idx + 1])}>▶</button>
        <div className="replay-playback">
          <SpeedControl className="btn" rate={rate} youtube={source?.type === 'youtube'} onRate={(r) => { setRate(r); player.current?.setRate(r); }} />
          {source?.type === 'file' && <FrameStep player={player} className="btn" />}
        </div>
        <button className="btn-ghost small" onClick={() => setLead((lead + 1) % LEADS.length)}>{LEADS[lead].label} clips</button>
        <label className="toggle replay-edit-toggle">
          <input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} />
          ✎ Suggest corrections
        </label>
      </div>

      {editing && source && (
        <button className="btn wide add-touch" onClick={startAdd}>＋ Missing touch? Add one at the current video time</button>
      )}
      {notice && <p className="small edit-notice">{notice} <button className="link" onClick={() => setNotice('')}>OK</button></p>}
      {target && match && (
        <EditSheet key={target.add ? `add-${target.add.t}` : target.event.id} token={token} event={target.event} add={target.add}
          players={players.filter((p) => p.active || p.id === target.event.player_id)}
          flip={!!match.calibration && ourHalfAt(match.calibration, target.event.t ?? 0) === 'far'}
          anchor={videoBox.current}
          controls={<>
            <button className="btn small" onClick={() => (target.add ? playAround(target.add.t) : play(target.event))} title="Play it again">↻</button>
            <SpeedControl className="btn small" rate={rate} youtube={source?.type === 'youtube'} onRate={(r) => { setRate(r); player.current?.setRate(r); }} />
          </>}
          onCancel={() => setTarget(null)}
          onSent={() => {
            if (!target.add) { const s = [...sent, target.event.id]; setSent(s); try { localStorage.setItem(sentKey(token), JSON.stringify(s)); } catch { /* private mode */ } }
            setNotice(target.add ? `✓ Sent: a new touch at ${fmtTime(target.add.t)}.` : '✓ Sent: your correction.');
            setTarget(null);
          }} />
      )}

      <ol className="replay-list">
        {clips.map((e) => (
          <li key={e.id} className={editing ? 'with-edit' : ''}>
            {editing && (
              <button className="replay-edit" disabled={!source || sent.includes(e.id)} onClick={() => startEdit(e)} title="Suggest a correction for this touch">
                {sent.includes(e.id) ? '✓' : '✎'}<small>{sent.includes(e.id) ? 'sent' : 'edit'}</small>
              </button>
            )}
            <button className={`replay-clip ${e.id === cur ? 'on' : ''}`} disabled={!source} onClick={() => { setPlayAll(false); play(e); }}>
              <span className="replay-time">{fmtTime(e.t!)}</span>
              <b>{who(e)}</b>
              <span className={`replay-act g-${ACTION_BY_CODE[e.action]?.group}`}>{ACTION_BY_CODE[e.action]?.label ?? e.action}{e.action === 'receive' && e.value != null ? ` ${e.value}` : ''}</span>
              <span className="muted small">Set {e.set_no ?? 1}{sent.includes(e.id) ? ' · ✎ sent' : ''}</span>
            </button>
          </li>
        ))}
        {!clips.length && <li className="muted small">No touches match these filters.</li>}
      </ol>
    </div>
  );
}
