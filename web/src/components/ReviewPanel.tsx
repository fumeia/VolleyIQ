import { useEffect, useRef, useState } from 'react';
import { ACTIONS, actionLabel, type ActionCode } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import type { PlayerHandle } from './VideoPlayer';
import { playerLabel } from './EventList';
import { fmtTime } from './TagPad';

interface Props {
  events: VEvent[];              // suggested events, in time order
  players: Player[];
  player: React.RefObject<PlayerHandle | null>;
  update: (e: VEvent, patch: Partial<VEvent>) => Promise<void>;
  remove: (e: VEvent) => Promise<void>;
  removeMany: (list: VEvent[]) => Promise<void>;
  confirmAll: () => void;
  onEdit: (e: VEvent) => void;
  onExit: () => void;
}

const PRE_ROLL = 2;
const POST_ROLL = 1.5;
const QUICK_ACTIONS: ActionCode[] = ['serve', 'receive', 'set', 'attack', 'kill', 'dig', 'block_touch', 'block_point', 'ace'];

/**
 * Second pass over auto-detected events: each suggestion plays a short clip
 * around its timestamp; one tap on a jersey fixes the player and confirms.
 */
export function ReviewPanel({ events, players, player, update, remove, removeMany, confirmAll, onEdit, onExit }: Props) {
  const [idx, setIdx] = useState(0);
  const [loop, setLoop] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const ev = events[Math.min(idx, events.length - 1)];
  const roster = players.filter((p) => p.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));

  function playClip(e: VEvent | undefined) {
    clearTimeout(timer.current);
    if (!e || e.t == null || !player.current) return;
    player.current.seek(e.t - PRE_ROLL);
    player.current.play();
    if (loop) timer.current = window.setTimeout(() => player.current?.pause(), (PRE_ROLL + POST_ROLL) * 1000);
  }

  useEffect(() => {
    playClip(ev);
    return () => clearTimeout(timer.current);
  }, [ev?.id]);

  if (!ev) {
    return (
      <div className="pad">
        <p>All suggestions reviewed. 🎉</p>
        <button className="btn btn-primary wide" onClick={onExit}>Back to tagging</button>
      </div>
    );
  }

  // After confirming/deleting, the list shrinks so the same index shows the next event.
  const confirm = (patch: Partial<VEvent> = {}) => update(ev, { ...patch, status: 'confirmed' });

  // Possessions alternate within a rally, so knowing whose touch this is settles every touch of the rally.
  const rally = ev.rally != null && ev.poss != null ? events.filter((e) => e.rally === ev.rally && e.poss != null) : [];
  function decideSide(ours: boolean) {
    const theirs = rally.filter((e) => (e.poss! % 2 === ev.poss! % 2) !== ours);
    removeMany(theirs);
  }
  const filled = events.filter((e) => e.hint);
  const opponentCount = (ours: boolean) => rally.filter((e) => (e.poss! % 2 === ev.poss! % 2) !== ours).length;

  return (
    <div className="pad review">
      <div className="pad-head">
        <span>Review <b>{Math.min(idx, events.length - 1) + 1}</b>/{events.length} · {fmtTime(ev.t)}</span>
        <button className="btn-ghost" onClick={onExit}>Done</button>
      </div>

      <div className="review-card">
        <div className="review-what">
          <span className="review-player">{playerLabel(players, ev)}</span>
          <span className="review-action">{actionLabel(ev)}</span>
          {ev.confidence != null && <span className="badge">AI {Math.round(ev.confidence * 100)}%</span>}
        </div>
        {ev.hint && (
          <p className="small hint-note">
            {ev.hint === 'gap'
              ? 'Not heard: the rally rhythm says a touch is missing around here (often the far side). Was there one?'
              : 'Quiet sound where a touch was missing in the rally (often the far side).'}
          </p>
        )}
        <div className="review-nav">
          <button className="btn" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>◀</button>
          <button className="btn" onClick={() => playClip(ev)}>↻ Replay</button>
          <label className="toggle small"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> stop after clip</label>
          <button className="btn" disabled={idx >= events.length - 1} onClick={() => setIdx((i) => i + 1)}>▶</button>
        </div>
      </div>

      {opponentCount(true) > 0 && opponentCount(false) > 0 && (
        <div className="side-row">
          <span className="small muted">Rally {ev.rally}: whose touch is this?</span>
          <button className="btn" onClick={() => decideSide(true)}>Ours <small>(drops {opponentCount(true)})</small></button>
          <button className="btn" onClick={() => decideSide(false)}>Theirs <small>(drops {opponentCount(false)})</small></button>
        </div>
      )}

      <span className="pad-group-label">Who touched it? (tap = fix + confirm)</span>
      <div className="pad-grid pad-players small-jerseys">
        {roster.map((p) => (
          <button key={p.id} className={`jersey role-${p.role} ${ev.player_id === p.id ? 'is-selected' : ''}`}
            onClick={() => confirm({ player_id: p.id, jersey: p.number })}>
            <span className="jersey-num">{p.number ?? '–'}</span>
            <span className="jersey-name">{p.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      <span className="pad-group-label">Action</span>
      <div className="chips">
        {QUICK_ACTIONS.map((code) => (
          <button key={code} className={`chip ${ev.action === code ? 'on' : ''}`}
            onClick={() => update(ev, { action: code, value: code === 'receive' ? ev.value ?? 2 : null })}>
            {ACTIONS.find((a) => a.code === code)!.short}
          </button>
        ))}
        <button className="chip" onClick={() => onEdit(ev)}>More…</button>
      </div>

      <div className="review-actions">
        <button className="btn btn-danger" onClick={() => remove(ev)}>✕ Not a touch</button>
        <button className="btn btn-primary" onClick={() => confirm()}>✓ Confirm</button>
      </div>
      <button className="btn-ghost small" onClick={() => { if (confirm_(`Confirm all ${events.length} remaining suggestions?`)) confirmAll(); }}>
        Confirm all remaining
      </button>
      <div className="bulk-row">
        <span className="small muted">Clear out noise: remove heard sounds with AI confidence below</span>
        <div className="chips">
          {[40, 50, 60].map((p) => {
            // Filled-in touches score low by design; they have their own button below.
            const weak = events.filter((e) => !e.hint && (e.confidence ?? 0) < p / 100);
            return (
              <button key={p} className="chip" disabled={!weak.length}
                onClick={() => { if (confirm_(`Remove ${weak.length} suggestions below ${p}%?`)) removeMany(weak); }}>
                {p}% <small>({weak.length})</small>
              </button>
            );
          })}
        </div>
        {filled.length > 0 && (
          <button className="btn-ghost small" onClick={() => { if (confirm_(`Remove all ${filled.length} filled-in touches (quiet or guessed)?`)) removeMany(filled); }}>
            Remove filled-in touches ({filled.length})
          </button>
        )}
      </div>
    </div>
  );
}

const confirm_ = (msg: string) => window.confirm(msg);
