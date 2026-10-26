import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_BY_CODE, SKILLS, wantsSpots, type ActionCode } from '../lib/actions';
import { api, type Match, type Player, type VEvent } from '../lib/api';
import type { Pt } from '../lib/court';
import { ActionPicker } from './ActionPicker';
import { CourtFull } from './CourtFull';
import { fmtTime } from './TagPad';
import { VideoPlayer, type PlayerHandle } from './VideoPlayer';

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
 * who spots a wrong tag can send the coach a suggestion; it is applied only when the
 * coach accepts it in the app.
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
  const [cur, setCur] = useState<number | null>(null);
  const [playAll, setPlayAll] = useState(false);
  const [editing, setEditing] = useState(false);
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

      <div className="replay-video">
        {source ? <VideoPlayer ref={player} source={source} /> : (
          <label className="replay-pick">
            <input type="file" accept="video/*" onChange={(e) => pickFile(e.target.files?.[0])} />
            <b>📁 Choose your copy of the match video</b>
            <span className="small muted">
              It plays here on your device and is not uploaded.{video?.type === 'file' ? <> The coach's file is called <b>{video.name}</b>.</> : ''}
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
        <button className="btn-ghost small" onClick={() => setLead((lead + 1) % LEADS.length)}>{LEADS[lead].label} clips</button>
        <label className="toggle replay-edit-toggle">
          <input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} />
          ✎ Suggest corrections
        </label>
      </div>

      {editing && current && (
        sent.includes(current.id)
          ? <p className="small muted">✓ You sent a correction for this touch. The coach will look at it.</p>
          : <EditBox key={current.id} token={token} event={current} players={players.filter((p) => p.active || p.id === current.player_id)}
              onSent={() => { const s = [...sent, current.id]; setSent(s); try { localStorage.setItem(sentKey(token), JSON.stringify(s)); } catch { /* private mode */ } }} />
      )}

      <ol className="replay-list">
        {clips.map((e) => (
          <li key={e.id}>
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

/** "Found a mistake?": the viewer's corrected tag, sent to the coach as a suggestion. */
function EditBox({ token, event, players, onSent }: { token: string; event: VEvent; players: Player[]; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<ActionCode>(event.action);
  const [value, setValue] = useState<number | null>(event.value);
  const [playerId, setPlayerId] = useState<number | null>(event.player_id);
  const [spot, setSpot] = useState<{ from: Pt | null; to: Pt | null } | null>(null);
  const [step, setStep] = useState<'from' | 'to'>('from');
  const [note, setNote] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem('viq:editName') ?? ''; } catch { return ''; } });
  const [state, setState] = useState<'idle' | 'confirm' | 'sending' | 'error'>('idle');
  const [err, setErr] = useState('');

  if (!open) return <button className="btn wide found-mistake" onClick={() => setOpen(true)}>Found a mistake in this touch? ✎ Edit it</button>;

  const def = ACTION_BY_CODE[action];
  const path = def?.court === 'path';
  const changes: Record<string, unknown> = {};
  if (action !== event.action) changes.action = action;
  if (value !== event.value) changes.value = value;
  if (playerId !== event.player_id) changes.player_id = playerId;
  if (spot) {
    const from = path ? spot.from : null;
    Object.assign(changes, { fx: from?.x ?? null, fy: from?.y ?? null, x: spot.to?.x ?? null, y: spot.to?.y ?? null });
  }
  const nothing = !Object.keys(changes).length && !note.trim();
  const shown = spot ?? { from: event.fx != null && event.fy != null ? { x: event.fx, y: event.fy } : null, to: event.x != null && event.y != null ? { x: event.x, y: event.y } : null };

  async function send() {
    setState('sending');
    try {
      try { localStorage.setItem('viq:editName', name); } catch { /* private mode */ }
      await api.sendEdit(token, { event_id: event.id, changes, note: note.trim(), name: name.trim() });
      onSent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send');
      setState('error');
    }
  }

  return (
    <div className="edit-box">
      <div className="row between"><b>Your correction</b><button className="btn-ghost small" onClick={() => setOpen(false)}>Cancel</button></div>
      <span className="field-label">Who played it</span>
      <div className="player-grid">
        {players.map((p) => (
          <button key={p.id} className={`jersey role-${p.role} ${playerId === p.id ? 'is-selected' : ''}`} onClick={() => setPlayerId(p.id)}>
            <span className="jersey-num">{p.number ?? '–'}</span><span className="jersey-name">{p.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>
      <span className="field-label">What it was</span>
      <ActionPicker value={action} onPick={(c) => { setAction(c); if (c !== 'receive') setValue(null); }} />
      {action === 'receive' && (
        <div className="pad-grid pad-grid-4 receive-quick">
          {[0, 1, 2, 3].map((g) => <button key={g} className={`act act-receive r${g} ${value === g ? 'is-selected' : ''}`} onClick={() => setValue(g)}>{g}</button>)}
        </div>
      )}
      {wantsSpots(action, 'points', 'all') && (
        <>
          <span className="field-label">
            Where {path ? (step === 'from' ? 'it was played from (1/2)' : 'it went (2/2)') : 'it was'} <small className="muted">· our side at the bottom · optional</small>
          </span>
          <div className="edit-court">
            <CourtFull from={shown.from} to={shown.to} label="court" onPick={(p) => {
              if (path && step === 'from') { setSpot({ from: p, to: null }); setStep('to'); }
              else { setSpot((s) => ({ from: path ? s?.from ?? null : null, to: p })); setStep('from'); }
            }} />
          </div>
          {spot && <button className="btn-ghost small" onClick={() => { setSpot(null); setStep('from'); }}>↺ Keep the coach's spots</button>}
        </>
      )}
      <textarea className="input" rows={2} maxLength={500} placeholder="Note for the coach (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <input className="input" maxLength={60} placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      {state === 'confirm' || state === 'sending' ? (
        <div className="row">
          <button className="btn btn-primary grow" disabled={state === 'sending'} onClick={send}>{state === 'sending' ? 'Sending…' : '✓ Send to the coach'}</button>
          <button className="btn" onClick={() => setState('idle')}>Back</button>
        </div>
      ) : (
        <button className="btn btn-primary wide" disabled={nothing} onClick={() => setState('confirm')}>Send correction…</button>
      )}
      {state === 'confirm' && <p className="small muted">The coach sees your correction and decides whether to take it. Nothing changes until then.</p>}
      {state === 'error' && <p className="small error">{err}</p>}
    </div>
  );
}
