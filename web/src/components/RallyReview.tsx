import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_BY_CODE, REVIEW_ACTIONS, wantsSpots, type ActionCode } from '../lib/actions';
import { api, type Match, type Player, type VEvent } from '../lib/api';
import { courtFields, type Pt } from '../lib/court';
import { duplicates, groupRallies, guessServing, isOurs, outcome, setAt, type Serving } from '../lib/rallyReview';
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
  /** Court spots as in the tagging settings: off, every action, or only serve / pass / attack. */
  spots: { location: 'points' | 'zones' | 'off'; scope: 'all' | 'key' };
  update: (e: VEvent, patch: Partial<VEvent>) => Promise<void>;
  add: (e: Partial<VEvent>) => string;
  removeMany: (list: VEvent[]) => Promise<void>;
  removeByClient: (clientId: string) => void;
  reload: () => Promise<unknown>;
  onTouchView: () => void;
  onLineup: (set: number) => void;
  onExit: () => void;
}

/** One question at a time for the selected touch. */
type Step = 'player' | 'action' | 'from' | 'to' | 'grade';

// Positions in court order as seen from behind our baseline: front row, then back row.
const COURT_ORDER = [4, 3, 2, 5, 6, 1];
const SPEEDS = [1, 1.5, 2];
const PRE_ROLL = 2;
const POST_ROLL = 1.5;
const STEP_PAUSE_MS = 700;

const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/**
 * Review one rally at a time. The rally plays once and its touches show as chips.
 * Tapping a chip walks through it: player, then action, then the court spots (the
 * court opens by itself), then on to the next touch. One button settles the rally
 * ("We won" / "They won" also records how the point ended).
 */
export function RallyReview({ match, suggested, confirmed, players, player, spots, update, add, removeMany, removeByClient, reload, onTouchView, onLineup, onExit }: Props) {
  const { rallies, info } = useMemo(() => groupRallies(suggested, match.calibration), [suggested, match.calibration]);
  const [idx, setIdx] = useState(0);
  const r = rallies[Math.min(idx, rallies.length - 1)];
  const [drafts, setDrafts] = useState<Record<number, Partial<VEvent>>>({});
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [serving, setServing] = useState<Serving>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [step, setStep] = useState<Step>('player');
  const [from, setFrom] = useState<Pt | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [speed, setSpeed] = useState(() => Number(load('viq:reviewSpeed', '1')) || 1);
  const [stepPause, setStepPause] = useState(() => load('viq:stepPause', '0') === '1');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ text: string; undo: () => Promise<void> } | null>(null);
  const stopAt = useRef<number | null>(null);
  const passed = useRef<Set<number>>(new Set());
  const jumpTo = useRef<number | null>(null);
  const selectAt = useRef<number | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const roster = players.filter((p) => p.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const lineup = r ? match.lineups?.[String(r.set)] : undefined;
  const rotation = useMemo(
    () => (r && lineup ? rotationAfter(lineup, pointsOfSet(confirmed, r.set, r.start), players, r.start) : null),
    [r?.key, r?.start, lineup, confirmed, players],
  );

  // After an undo or a new rally, show that rally.
  useEffect(() => {
    if (jumpTo.current == null) return;
    const i = rallies.findIndex((x) => x.start >= jumpTo.current! - 0.05);
    if (i >= 0) { setIdx(i); jumpTo.current = null; }
  }, [rallies]);

  // New rally: fresh state (touches heard twice already folded), play it.
  useEffect(() => {
    if (!r) return;
    setDrafts({});
    setRemoved(new Set(duplicates(r.events)));
    setServing(rotation ? (rotation.weServe ? 'us' : 'them') : guessServing(r.events, info));
    setSel(null);
    playRally();
  }, [r?.key, r?.start]);

  // A touch just added by hand: open it.
  useEffect(() => {
    if (selectAt.current == null || !r) return;
    const e = r.events.find((x) => x.t != null && Math.abs(x.t - selectAt.current!) < 0.02);
    if (e) { open(e, false); selectAt.current = null; }
  }, [rallies]);

  // Keep the open question in view (the video stays pinned above it).
  useEffect(() => {
    if (sel != null) editor.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel, step]);

  // Follow the video: highlight the touch being played, stop after the clip, optional pause at each touch.
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

  /**
   * A touch (or a whole rally) the analysis missed or that was deleted: added at the
   * current video time as a suggestion, so it is saved with the rest of its rally.
   */
  async function addAt(newRally: boolean) {
    const t = player.current?.time();
    if (t == null || busy || (!r && !newRally)) return;
    setBusy(true);
    try {
      player.current?.pause();
      const at = Math.round(t * 100) / 100;
      const numbered = !r || /^\d+$/.test(r.key);
      // Kept as ours: possession parity matching who served (0 = the serve).
      const rally = numbered ? (newRally || !r ? 900000 + Math.round(at * 10) : Number(r.key)) : null;
      const poss = newRally ? 0 : serving === 'them' ? 1 : 2;
      await api.addEvent(match.id, {
        t: at, action: newRally ? 'serve' : 'dig', status: 'suggested', source: 'auto',
        rally, poss: rally == null ? null : poss, set_no: newRally || !r ? setAt(match.calibration, at) : r.set,
      });
      if (newRally) jumpTo.current = at;
      selectAt.current = at;
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function runUndo() {
    if (!last || busy) return;
    setBusy(true);
    try { await last.undo(); setLast(null); } finally { setBusy(false); }
  }

  if (!r) {
    return (
      <div className="pad">
        <p>All rallies reviewed. 🎉</p>
        <button className="btn wide" disabled={busy} onClick={() => addAt(true)}>+ Rally the analysis missed, at the current video time</button>
        {last && <button className="btn wide" onClick={runUndo}>↶ Undo: {last.text}</button>}
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
  const isTheirs = (e: VEvent) => !isOurs(info.get(e.id), serving);
  const ours = (e: VEvent) => !isTheirs(e) && !removed.has(e.id);
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

  /** Open a touch at its first question and replay its moment (stopping right after the contact). */
  function open(e: VEvent, play = true) {
    setSel(e.id);
    setStep('player');
    const v = view(e);
    setFrom(v.fx != null && v.fy != null ? { x: v.fx, y: v.fy } : null);
    if (play && e.t != null) playFrom(e.t - 1.5, e.t + 0.3);
  }

  /** Next of our touches after [e]; none left = the rally is ready to be settled. */
  function advance(e: VEvent) {
    const next = r.events.find((x) => (x.t ?? 0) > (e.t ?? 0) && ours(x));
    if (next) open(next);
    else setSel(null);
  }

  function chooseAction(e: VEvent, code: ActionCode) {
    const v = view(e);
    patch(e, { action: code, value: code === 'receive' ? v.value : null });
    if (wantsSpots(code, spots.location, spots.scope)) {
      setStep(ACTION_BY_CODE[code].court === 'path' ? 'from' : 'to');
      // The contact frame, to see where it happened.
      if (e.t != null) { player.current?.pause(); player.current?.seek(e.t); }
    } else if (code === 'receive') setStep('grade');
    else advance(e);
  }

  function pickSpot(e: VEvent, p: Pt) {
    if (step === 'from') { setFrom(p); setStep('to'); return; }
    patch(e, courtFields(view(e).action, from, p));
    advance(e);
  }

  function removeTouch(e: VEvent) {
    setRemoved((s) => new Set(s).add(e.id));
    advance(e);
  }

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

  function tapChip(e: VEvent) {
    if (removed.has(e.id)) {
      // Removed by mistake (or folded as a duplicate): bring it back.
      setRemoved((s) => { const n = new Set(s); n.delete(e.id); return n; });
      return open(e);
    }
    if (isTheirs(e)) return open(e);
    if (e.id === sel) { setSel(null); return; }
    open(e);
  }

  function cycleSpeed() {
    const s = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
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
  const court = rotation
    ? COURT_ORDER.map((pos) => players.find((p) => p.id === rotation.positions[pos - 1])).filter((p): p is Player => !!p)
    : [];
  const bench = roster.filter((p) => !court.includes(p));
  const setterPos = rotation ? rotation.positions.findIndex((id) => players.find((p) => p.id === id)?.role === 'S') + 1 : 0;
  const removedCount = r.events.filter((e) => removed.has(e.id)).length;

  const jersey = (p: Player) => (
    <button key={p.id} className={`jersey-mini role-${p.role} ${sv?.player_id === p.id ? 'is-selected' : ''} ${eligible && !eligible.has(p.id) ? 'dim' : ''}`}
      onClick={() => { if (!selected) return; patch(selected, { player_id: p.id, jersey: p.number }); setStep('action'); }}>
      {p.number ?? '–'}<small>{p.name.split(' ')[0]}</small>
    </button>
  );

  return (
    <div className="pad rally-review">
      <div className="rr-head">
        <span>Rally <b>{Math.min(idx, rallies.length - 1) + 1}</b>/{rallies.length} · {fmtTime(r.start)} · Set {r.set}</span>
        <button className="btn-ghost small" onClick={onTouchView} title="Review touch by touch">≡</button>
        <button className="btn-ghost small" onClick={onExit}>Done</button>
      </div>

      <div className="rally-card" onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }} onPointerUp={onSwipeEnd}>
        <div className="strip">
          {r.events.map((e) => {
            const v = view(e);
            const gone = removed.has(e.id);
            return (
              <button key={e.id}
                className={`touch-chip ${isTheirs(e) ? 'theirs' : ''} ${gone ? 'gone' : ''} ${sel === e.id ? 'sel' : ''} ${playing?.id === e.id ? 'now' : ''}`}
                title={gone ? 'Removed: tap to bring it back' : undefined}
                onClick={() => tapChip(e)}>
                <b>{ACTION_BY_CODE[v.action]?.short ?? v.action}</b>
                <span>{gone ? '↺' : `${num(v)}${e.hint ? ' ?' : ''}${v.x != null || v.fx != null ? ' 📍' : ''}`}</span>
              </button>
            );
          })}
          <button className="touch-chip add" disabled={busy || now == null} onClick={() => addAt(false)} title="Add a touch at the current video time">
            <b>+</b><span>{now != null ? fmtTime(now) : ''}</span>
          </button>
        </div>
        {!selected && <div className="rr-tools">
          <button className="icon-btn" onClick={playRally} title="Replay the rally">↻</button>
          <button className="icon-btn" onClick={cycleSpeed} title="Playback speed">{speed}×</button>
          <button className={`icon-btn ${stepPause ? 'on' : ''}`} title="Pause briefly at each touch"
            onClick={() => { setStepPause(!stepPause); store('viq:stepPause', stepPause ? '0' : '1'); }}>⏸·</button>
          <span className="rr-serve">
            Served:
            <button className={`chip ${serving === 'us' ? 'on' : ''}`} onClick={() => setServing('us')}>Us</button>
            <button className={`chip ${serving === 'them' ? 'on' : ''}`} onClick={() => setServing('them')}>Them</button>
          </span>
          <button className="icon-btn" disabled={busy || now == null} onClick={() => addAt(true)} title="Start a new rally at the current video time">+ Rally</button>
          <button className="icon-btn" title="Remove all touches of this rally, then add them with +"
            onClick={() => { setRemoved(new Set(r.events.map((e) => e.id))); setSel(null); }}>Empty</button>
        </div>}
        {!selected && <div className="rotation-info">
          {rotation
            ? <>Setter in {setterPos || '?'} · {rotation.weServe ? 'we serve' : 'they serve'} · <button className="link" onClick={() => onLineup(r.set)}>line-up</button></>
            : <><button className="link" onClick={() => onLineup(r.set)}>Enter the line-up</button> to fill in servers and setters</>}
          {removedCount > 0 && <> · {removedCount} removed (tap ↺ to restore)</>}
          {serving == null && <> · greyed = their touch</>}
        </div>}
      </div>

      {selected && sv && def && (isTheirs(selected) ? (
        <div className="touch-editor">
          <span className="small">This touch is counted as theirs.</span>
          <button className="btn small" onClick={() => setServing(serving === 'us' ? 'them' : 'us')}>No, it's ours (swap sides)</button>
        </div>
      ) : (
        <div className="touch-editor" ref={editor}>
          <div className="crumbs">
            <button className={step === 'player' ? 'on' : ''} onClick={() => setStep('player')}>{num(sv) || 'Who?'}</button>›
            <button className={step === 'action' ? 'on' : ''} onClick={() => setStep('action')}>{def.short}</button>
            {wantsSpots(sv.action, spots.location, spots.scope) && <>›<button className={step === 'from' || step === 'to' ? 'on' : ''}
              onClick={() => setStep(def.court === 'path' ? 'from' : 'to')}>📍{sv.x != null ? ' ✓' : ''}</button></>}
            <span className="crumbs-end">
              <button className="btn-ghost small danger" onClick={() => removeTouch(selected)}>✕ Not a touch</button>
              <button className="btn-ghost small" onClick={() => advance(selected)}>Next ▸</button>
            </span>
          </div>

          {step === 'player' && (
            <div className="player-grid">
              {court.map(jersey)}
              {court.length > 0 && bench.length > 0 && <span className="grid-break" />}
              {(court.length ? bench : roster).map(jersey)}
            </div>
          )}

          {step === 'action' && (
            <div className="chips tight">
              {REVIEW_ACTIONS.map((c) => (
                <button key={c} className={`chip chip-${ACTION_BY_CODE[c].group} ${sv.action === c ? 'on' : ''}`}
                  onClick={() => chooseAction(selected, c)}>{ACTION_BY_CODE[c].short}</button>
              ))}
            </div>
          )}

          {(step === 'from' || step === 'to') && (
            <div className="review-court">
              <div className="row between">
                <span className="small"><b>{step === 'from' ? def.fromPrompt : def.toPrompt}</b>{def.court === 'path' ? ` (${step === 'from' ? 1 : 2}/2)` : ''}</span>
                <button className="btn-ghost small" onClick={() => (step === 'from' ? setStep('to') : advance(selected))}>
                  {step === 'from' ? (from ? 'Keep ⚪' : 'Skip') : sv.x != null ? 'Keep 🟠' : 'Skip'}
                </button>
              </div>
              <CourtFull sideways="auto" from={from} to={sv.x != null && sv.y != null ? { x: sv.x, y: sv.y } : null}
                showTarget={sv.action === 'receive' && step === 'to'} onPick={(p) => pickSpot(selected, p)} />
            </div>
          )}

          {step === 'grade' && (
            <div className="pad-grid pad-grid-4 receive-quick">
              {[0, 1, 2, 3].map((g) => (
                <button key={g} className={`act act-receive r${g}`} onClick={() => { patch(selected, { value: g }); advance(selected); }}>{g}</button>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className={`rally-actions ${!selected ? 'ready' : ''}`}>
        <button className="btn btn-won" disabled={busy} onClick={() => finish('won')}>We won <small>{outcomeText(true)}</small></button>
        <button className="btn btn-lost" disabled={busy} onClick={() => finish('lost')}>They won <small>{outcomeText(false)}</small></button>
        <button className="btn" disabled={busy} onClick={() => finish(null)}>✓ Save <small>no point</small></button>
        <button className="btn btn-danger" disabled={busy} onClick={notARally}>✕ <small>not a rally</small></button>
      </div>
      <div className="row between">
        <button className="btn-ghost small" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>◀ Prev</button>
        {last && <button className="btn-ghost small" disabled={busy} onClick={runUndo}>↶ Undo {last.text}</button>}
        <button className="btn-ghost small" disabled={idx >= rallies.length - 1} onClick={() => setIdx((i) => i + 1)}>Skip ▶</button>
      </div>
    </div>
  );
}
