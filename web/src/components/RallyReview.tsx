import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_BY_CODE, type ActionCode } from '../lib/actions';
import { api, type Match, type Player, type VEvent } from '../lib/api';
import { courtFields, type Pt } from '../lib/court';
import { groupRallies, guessServing, isOurs, outcome, type Serving } from '../lib/rallyReview';
import { candidates, pointsOfSet, rotationAfter } from '../lib/rotation';
import { CourtFull } from './CourtFull';
import { fmtTime } from './TagPad';
import type { PlayerHandle } from './VideoPlayer';

interface Props {
  match: Match;
  suggested: VEvent[];
  /** Saved events: the points so far give the rotation. */
  confirmed: VEvent[];
  players: Player[];
  player: React.RefObject<PlayerHandle | null>;
  update: (e: VEvent, patch: Partial<VEvent>) => Promise<void>;
  add: (e: Partial<VEvent>) => string;
  removeMany: (list: VEvent[]) => Promise<void>;
  removeByClient: (clientId: string) => void;
  reload: () => Promise<unknown>;
  onTouchView: () => void;
  onLineup: (set: number) => void;
  onExit: () => void;
}

// Positions in court order as seen from behind our baseline: front row, then back row.
const COURT_ORDER = [4, 3, 2, 5, 6, 1];

const ACTION_CHOICES: ActionCode[] = [
  'serve', 'receive', 'set', 'attack', 'dig', 'freeball', 'block_touch',
  'ace', 'kill', 'block_point', 'serve_error', 'attack_error', 'attack_blocked', 'set_error', 'dig_error',
];
const SPEEDS = [1, 1.5, 2];
const PRE_ROLL = 2;
const POST_ROLL = 1.5;
const STEP_PAUSE_MS = 700;

const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/**
 * Review one rally at a time: the rally plays once, its touches show as a strip of
 * chips, and one button settles it ("We won" / "They won" also records how the point
 * ended). Everything fits one screen; the next rally starts by itself.
 */
export function RallyReview({ match, suggested, confirmed, players, player, update, add, removeMany, removeByClient, reload, onTouchView, onLineup, onExit }: Props) {
  const { rallies, info } = useMemo(() => groupRallies(suggested, match.calibration), [suggested, match.calibration]);
  const [idx, setIdx] = useState(0);
  const r = rallies[Math.min(idx, rallies.length - 1)];
  const [drafts, setDrafts] = useState<Record<number, Partial<VEvent>>>({});
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [serving, setServing] = useState<Serving>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [court, setCourt] = useState<{ stage: 'from' | 'to'; from: Pt | null } | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [speed, setSpeed] = useState(() => Number(load('viq:reviewSpeed', '1')) || 1);
  const [stepPause, setStepPause] = useState(() => load('viq:stepPause', '0') === '1');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ text: string; undo: () => Promise<void> } | null>(null);
  const stopAt = useRef<number | null>(null);
  const passed = useRef<Set<number>>(new Set());
  const jumpTo = useRef<number | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const roster = players.filter((p) => p.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const lineup = r ? match.lineups?.[String(r.set)] : undefined;
  const rotation = useMemo(
    () => (r && lineup ? rotationAfter(lineup, pointsOfSet(confirmed, r.set, r.start), players) : null),
    [r?.key, r?.start, lineup, confirmed, players],
  );

  // After an undo, show the restored rally again.
  useEffect(() => {
    if (jumpTo.current == null) return;
    const i = rallies.findIndex((x) => x.start >= jumpTo.current! - 0.05);
    if (i >= 0) { setIdx(i); jumpTo.current = null; }
  }, [rallies]);

  // New rally: fresh state, play it.
  useEffect(() => {
    if (!r) return;
    setDrafts({});
    setRemoved(new Set());
    setServing(rotation ? (rotation.weServe ? 'us' : 'them') : guessServing(r.events, info));
    setSel(null);
    setCourt(null);
    playRally();
  }, [r?.key, r?.start]);

  // Follow the video: highlight the touch being played, stop after the rally, optional pause at each touch.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const p = player.current;
      const t = p?.time();
      if (!p || t == null) return;
      setNow(t);
      if (!p.isPlaying()) return;
      if (stopAt.current != null && t >= stopAt.current) { p.pause(); stopAt.current = null; return; }
      if (stepPause && r) {
        const hit = r.events.find((e) => e.t != null && e.t <= t && e.t > t - 0.4 && !passed.current.has(e.id));
        if (hit) {
          passed.current.add(hit.id);
          p.pause();
          window.setTimeout(() => player.current?.play(), STEP_PAUSE_MS);
        }
      }
    }, 120);
    return () => clearInterval(timer);
  }, [r?.key, stepPause]);

  // Desktop keys: W = we won, L = they won, N = not a rally, Enter = save without point.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || busy || !r) return;
      const k = e.key.toLowerCase();
      if (k === 'w') finish('won');
      else if (k === 'l') finish('lost');
      else if (k === 'n') notARally();
      else if (k === 'enter') finish(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function playFrom(t0: number, t1: number) {
    const p = player.current;
    if (!p) return;
    p.setRate(speed);
    p.seek(Math.max(0, t0));
    p.play();
    stopAt.current = t1;
    passed.current = new Set();
  }
  const playRally = () => r && playFrom(r.start - PRE_ROLL, r.end + POST_ROLL);

  if (!r) {
    return (
      <div className="pad">
        <p>All rallies reviewed. 🎉</p>
        {last && <button className="btn wide" onClick={() => runUndo()}>↶ Undo: {last.text}</button>}
        <button className="btn btn-primary wide" onClick={onExit}>Back to tagging</button>
      </div>
    );
  }

  // With a line-up, the server and the setter are filled in when the app could not read the number.
  const auto = (e: VEvent): Partial<VEvent> => {
    if (!rotation || e.player_id != null || !isOurs(info.get(e.id), serving)) return {};
    const action = drafts[e.id]?.action ?? e.action;
    if (!['serve', 'ace', 'serve_error', 'set', 'assist'].includes(action)) return {};
    const id = candidates(rotation, action, players).likely;
    const p = players.find((x) => x.id === id);
    return p ? { player_id: p.id, jersey: p.number } : {};
  };
  const view = (e: VEvent): VEvent => ({ ...e, ...auto(e), ...drafts[e.id] });
  const ours = (e: VEvent) => isOurs(info.get(e.id), serving) && !removed.has(e.id);
  const kept = r.events.filter(ours);
  const lastTouch = [...r.events].reverse().find((e) => !removed.has(e.id)) ?? null;
  const lastIsOurs = lastTouch ? ours(lastTouch) : true;
  const playing = [...r.events].reverse().find((e) => now != null && e.t != null && e.t <= now + 0.1);
  const selected = r.events.find((e) => e.id === sel) ?? null;
  const num = (v: VEvent) => {
    const p = players.find((x) => x.id === v.player_id);
    return p ? `#${p.number ?? '?'}` : v.jersey != null ? `#${v.jersey}?` : '';
  };
  const outcomeText = (won: boolean) => {
    const o = outcome(lastTouch ? { id: lastTouch.id, action: view(lastTouch).action } : null, lastIsOurs, won);
    if (o.add) return o.add === 'opp_error' ? 'their error' : 'their point';
    const def = ACTION_BY_CODE[o.change!.action];
    return `${num(view(lastTouch!))} ${o.change!.value === 0 ? 'Rec 0' : def.short}`;
  };
  const patch = (e: VEvent, p: Partial<VEvent>) => setDrafts((d) => ({ ...d, [e.id]: { ...d[e.id], ...p } }));

  async function finish(result: 'won' | 'lost' | null) {
    if (busy) return;
    setBusy(true);
    const rally = r;
    try {
      const drop = rally.events.filter((e) => !ours(e));
      const o = result
        ? outcome(lastTouch ? { id: lastTouch.id, action: view(lastTouch).action } : null, lastIsOurs, result === 'won')
        : {};
      const originals = kept.map((e) => ({ ...e }));
      await Promise.all(kept.map((e) => update(e, {
        ...auto(e),
        ...drafts[e.id],
        ...(o.change?.id === e.id ? { action: o.change.action, ...(o.change.value !== undefined ? { value: o.change.value } : {}) } : {}),
        set_no: e.set_no ?? rally.set,
        status: 'confirmed',
      })));
      const clientId = o.add ? add({ action: o.add, t: rally.end + 0.5, set_no: rally.set }) : null;
      if (drop.length) await removeMany(drop);
      const text = `rally at ${fmtTime(rally.start)}${result ? (result === 'won' ? ' (won)' : ' (lost)') : ''}`;
      setLast({
        text,
        undo: async () => {
          if (clientId) removeByClient(clientId);
          await Promise.all(originals.map((e) => update(e, {
            action: e.action, value: e.value, player_id: e.player_id, jersey: e.jersey, zone: e.zone,
            x: e.x, y: e.y, fx: e.fx, fy: e.fy, set_no: e.set_no, status: 'suggested',
          })));
          await restore(drop);
          jumpTo.current = rally.start;
        },
      });
    } finally {
      setBusy(false);
    }
  }

  async function notARally() {
    if (busy) return;
    setBusy(true);
    const rally = r;
    try {
      await removeMany(rally.events);
      setLast({ text: `removed rally at ${fmtTime(rally.start)}`, undo: async () => { await restore(rally.events); jumpTo.current = rally.start; } });
    } finally {
      setBusy(false);
    }
  }

  // Deleted suggestions come back as new suggestions with the same content.
  async function restore(list: VEvent[]) {
    if (!list.length) return;
    for (const e of list) {
      const { id: _id, match_id: _m, client_id: _c, ...rest } = e;
      await api.addEvent(match.id, { ...rest, source: 'auto', status: 'suggested' });
    }
    await reload();
  }

  async function runUndo() {
    if (!last || busy) return;
    setBusy(true);
    try { await last.undo(); setLast(null); } finally { setBusy(false); }
  }

  function select(e: VEvent) {
    setSel(e.id === sel ? null : e.id);
    setCourt(null);
    if (e.t != null) playFrom(e.t - 1.5, e.t + 1);
  }

  function setSpeedTo(s: number) {
    setSpeed(s);
    store('viq:reviewSpeed', String(s));
    player.current?.setRate(s);
  }

  // Swipe the rally card: left = not a rally, right = save without point.
  function onSwipeEnd(e: React.PointerEvent) {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 90 || Math.abs(e.clientY - s.y) > 60) return;
    if (dx < 0) notARally();
    else finish(null);
  }

  const sv = selected ? view(selected) : null;
  const def = sv ? ACTION_BY_CODE[sv.action] : null;
  const eligible = rotation && sv ? candidates(rotation, sv.action, players).eligible : null;
  // On-court players first (front row 4-3-2, back row 5-6-1), then the bench.
  function playerRow(): (Player | 'divider')[] {
    if (!rotation) return roster;
    const court = COURT_ORDER.map((pos) => players.find((p) => p.id === rotation.positions[pos - 1])).filter((p): p is Player => !!p);
    const bench = roster.filter((p) => !court.includes(p));
    return bench.length ? [...court, 'divider', ...bench] : court;
  }
  const setterPos = rotation ? rotation.positions.findIndex((id) => players.find((p) => p.id === id)?.role === 'S') + 1 : 0;

  return (
    <div className="pad rally-review">
      <div className="pad-head">
        <span>Rally <b>{Math.min(idx, rallies.length - 1) + 1}</b>/{rallies.length} · Set {r.set} · {fmtTime(r.start)}</span>
        <span className="row">
          <button className="btn-ghost small" onClick={onTouchView}>Touch by touch</button>
          <button className="btn-ghost" onClick={onExit}>Done</button>
        </span>
      </div>

      <div className="rally-card" onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }} onPointerUp={onSwipeEnd}>
        <div className="strip">
          {r.events.map((e) => {
            const v = view(e);
            const mine = ours(e);
            return (
              <button key={e.id}
                className={`touch-chip ${mine ? '' : 'theirs'} ${sel === e.id ? 'sel' : ''} ${playing?.id === e.id ? 'now' : ''}`}
                onClick={() => select(e)}>
                <b>{ACTION_BY_CODE[v.action]?.short ?? v.action}</b>
                <span>{num(v)}{e.hint ? ' ?' : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="rally-tools">
          <button className="btn-ghost small" onClick={playRally}>↻ Replay</button>
          <span className="speed">
            {SPEEDS.map((s) => <button key={s} className={`chip ${speed === s ? 'on' : ''}`} onClick={() => setSpeedTo(s)}>{s}×</button>)}
          </span>
          <label className="toggle small"><input type="checkbox" checked={stepPause}
            onChange={(e) => { setStepPause(e.target.checked); store('viq:stepPause', e.target.checked ? '1' : '0'); }} /> pause at touches</label>
        </div>
        <div className="rotation-info">
          {rotation
            ? <>Rotation: setter in position {setterPos || '?'} · {rotation.weServe ? 'we serve' : 'they serve'} · <button className="link" onClick={() => onLineup(r.set)}>line-up</button></>
            : <>No line-up for set {r.set}: <button className="link" onClick={() => onLineup(r.set)}>enter the starting six</button> to fill in servers and setters</>}
        </div>
        <div className="serving">
          <span className="small muted">Who served?</span>
          <button className={`chip ${serving === 'us' ? 'on' : ''}`} onClick={() => setServing('us')}>We did</button>
          <button className={`chip ${serving === 'them' ? 'on' : ''}`} onClick={() => setServing('them')}>They did</button>
          {serving == null && <span className="small muted">(greyed = their touch, not saved)</span>}
        </div>
      </div>

      {selected && sv && def && (ours(selected) ? (
        <div className="touch-editor">
          <div className="scroll-row">
            {playerRow().map((p, i) => p === 'divider' ? <span key={`d${i}`} className="court-divider" /> : (
              <button key={p.id} className={`jersey-mini role-${p.role} ${sv.player_id === p.id ? 'is-selected' : ''} ${eligible && !eligible.has(p.id) ? 'dim' : ''}`}
                onClick={() => patch(selected, { player_id: p.id, jersey: p.number })}>
                {p.number ?? '–'}<small>{p.name.split(' ')[0]}</small>
              </button>
            ))}
          </div>
          <div className="chips tight">
            {ACTION_CHOICES.map((c) => (
              <button key={c} className={`chip ${sv.action === c ? 'on' : ''}`}
                onClick={() => patch(selected, { action: c, value: c === 'receive' ? sv.value : null })}>{ACTION_BY_CODE[c].short}</button>
            ))}
          </div>
          {sv.action === 'receive' && (
            <div className="chips tight">
              {[0, 1, 2, 3].map((v) => <button key={v} className={`chip ${sv.value === v ? 'on' : ''}`} onClick={() => patch(selected, { value: v })}>Pass {v}</button>)}
            </div>
          )}
          <div className="row wrap">
            {def.court && (
              <button className="btn small" onClick={() => setCourt(court ? null : { stage: def.court === 'path' ? 'from' : 'to', from: sv.fx != null && sv.fy != null ? { x: sv.fx, y: sv.fy } : null })}>
                📍 {court ? 'Close court' : sv.x != null || sv.fx != null ? 'Edit spots' : 'Add spots'}
              </button>
            )}
            <button className="btn small btn-danger" onClick={() => { setRemoved((s) => new Set(s).add(selected.id)); setSel(null); }}>✕ Not a touch</button>
          </div>
          {court && (
            <div className="review-court">
              <span className="small muted">{court.stage === 'from' ? def.fromPrompt : def.toPrompt}</span>
              <CourtFull from={court.from} to={sv.x != null && sv.y != null ? { x: sv.x, y: sv.y } : null} showTarget={sv.action === 'receive'}
                onPick={(p) => {
                  if (court.stage === 'from') setCourt({ stage: 'to', from: p });
                  else { patch(selected, courtFields(sv.action, court.from, p)); setCourt(null); }
                }} />
              {court.stage === 'from' && <button className="btn-ghost small" onClick={() => setCourt({ ...court, stage: 'to' })}>Skip: not sure where from</button>}
            </div>
          )}
        </div>
      ) : (
        <div className="touch-editor">
          <span className="small">This touch is counted as theirs.</span>
          <button className="btn small" onClick={() => setServing(serving === 'us' ? 'them' : 'us')}>No, it's ours (swap sides)</button>
        </div>
      ))}

      <div className="rally-actions">
        <button className="btn btn-won" disabled={busy} onClick={() => finish('won')}>We won <small>{outcomeText(true)}</small></button>
        <button className="btn btn-lost" disabled={busy} onClick={() => finish('lost')}>They won <small>{outcomeText(false)}</small></button>
        <button className="btn btn-danger" disabled={busy} onClick={notARally}>✕ Not a rally</button>
        <button className="btn" disabled={busy} onClick={() => finish(null)}>✓ Save, no point</button>
      </div>
      <div className="row between">
        <button className="btn-ghost small" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>◀ Previous</button>
        {last && <button className="btn-ghost small" disabled={busy} onClick={runUndo}>↶ Undo {last.text}</button>}
        <button className="btn-ghost small" disabled={idx >= rallies.length - 1} onClick={() => setIdx((i) => i + 1)}>Skip ▶</button>
      </div>
      <span className="small muted">Tip: tap a touch to fix it. Swipe the rally left = not a rally, right = save. Keys: W / L / N / Enter.</span>
    </div>
  );
}
