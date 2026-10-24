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
export function ReviewPanel({ events, players, player, update, remove, confirmAll, onEdit, onExit }: Props) {
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
        <div className="review-nav">
          <button className="btn" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>◀</button>
          <button className="btn" onClick={() => playClip(ev)}>↻ Replay</button>
          <label className="toggle small"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> stop after clip</label>
          <button className="btn" disabled={idx >= events.length - 1} onClick={() => setIdx((i) => i + 1)}>▶</button>
        </div>
      </div>

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
    </div>
  );
}

const confirm_ = (msg: string) => window.confirm(msg);
