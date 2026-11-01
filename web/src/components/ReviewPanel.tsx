import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_BY_CODE, actionLabel } from '../lib/actions';
import { ActionPicker } from './ActionPicker';
import type { Player, VEvent } from '../lib/api';
import { courtFields, type Pt } from '../lib/court';
import { rallyInfo, sideToDrop } from '../lib/rallies';
import { CourtFull } from './CourtFull';
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
  onRallyView?: () => void;
}

const PRE_ROLL = 2;
const POST_ROLL = 1.5;

type Draft = Pick<VEvent, 'player_id' | 'jersey' | 'action' | 'value'> & {
  /** Where the ball was played from, and which court tap comes next. */
  from: Pt | null;
  stage: 'from' | 'to';
};

/**
 * Second pass over auto-detected events: each suggestion plays a short clip
 * around its timestamp. Pick (or keep) the player and the action, then tap the
 * court where the ball went; only that saves the touch.
 */
export function ReviewPanel({ events, players, player, update, remove, removeMany, confirmAll, onEdit, onExit, onRallyView }: Props) {
  const [idx, setIdx] = useState(0);
  const [loop, setLoop] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const ev = events[Math.min(idx, events.length - 1)];
  const roster = players.filter((p) => p.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const info = useMemo(() => rallyInfo(events), [events]);

  function playClip(e: VEvent | undefined) {
    clearTimeout(timer.current);
    if (!e || e.t == null || !player.current) return;
    player.current.seek(e.t - PRE_ROLL);
    player.current.play();
    if (loop) timer.current = window.setTimeout(() => player.current?.pause(), (PRE_ROLL + POST_ROLL) * 1000);
  }

  useEffect(() => {
    playClip(ev);
    setDraft(null);
    return () => clearTimeout(timer.current);
  }, [ev?.id]);

  if (!ev) {
    return (
      <div className="pad">
        <p>All suggestions reviewed.</p>
        <button className="btn btn-primary wide" onClick={onExit}>Back to tagging</button>
      </div>
    );
  }

  // Changes stay in the draft until the touch is saved (court tap or a save button).
  const d: Draft = draft ?? {
    player_id: ev.player_id, jersey: ev.jersey, action: ev.action, value: ev.value,
    from: ev.fx != null && ev.fy != null ? { x: ev.fx, y: ev.fy } : null,
    stage: ACTION_BY_CODE[ev.action]?.court === 'path' ? 'from' : 'to',
  };
  const def = ACTION_BY_CODE[d.action];
  const point = ev.x != null && ev.y != null ? { x: ev.x, y: ev.y } : null;
  const first = def?.court === 'path' && d.stage === 'from';
  // After saving/deleting, the list shrinks so the same index shows the next event.
  const save = (patch: Partial<VEvent> = {}) => {
    const { from, stage: _s, ...fields } = d;
    return update(ev, { ...fields, ...courtFields(d.action, from, point), value: d.value, ...patch, status: 'confirmed' });
  };

  // Possessions alternate within a rally, so knowing whose touch this is settles every touch of the rally.
  const dropIfOurs = sideToDrop(events, info, ev, true);
  const dropIfTheirs = sideToDrop(events, info, ev, false);
  const rallyNo = info.get(ev.id)?.rally;
  const filled = events.filter((e) => e.hint);

  return (
    <div className="pad review">
      <div className="pad-head">
        <span>Review <b>{Math.min(idx, events.length - 1) + 1}</b>/{events.length} · {fmtTime(ev.t)}</span>
        <span className="row">
          {onRallyView && <button className="btn-ghost small" onClick={onRallyView}>Rally by rally</button>}
          <button className="btn-ghost" onClick={onExit}>Done</button>
        </span>
      </div>

      <div className="review-card" onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          // Swipe right = save as shown, left = not a touch.
          const s0 = swipe.current;
          swipe.current = null;
          if (!s0 || Math.abs(e.clientX - s0.x) < 90 || Math.abs(e.clientY - s0.y) > 60) return;
          if (e.clientX > s0.x) save(); else remove(ev);
        }}>
        <div className="review-what">
          <span className="review-player">{playerLabel(players, { ...ev, ...d })}</span>
          <span className="review-action">{actionLabel(d)}</span>
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

      {rallyNo != null && (
        <div className="side-row">
          <span className="small muted">Rally {rallyNo.replace('~', '')}: whose touch is this? Settles the whole rally.</span>
          <button className="btn" disabled={!dropIfOurs.length} onClick={() => removeMany(dropIfOurs)}>
            Ours <small>(removes {dropIfOurs.length} of theirs)</small>
          </button>
          <button className="btn" onClick={() => removeMany(dropIfTheirs)}>
            Theirs <small>(removes {dropIfTheirs.length})</small>
          </button>
        </div>
      )}

      <span className="pad-group-label">1 · Who touched it?</span>
      <div className="pad-grid pad-players small-jerseys">
        {roster.map((p) => (
          <button key={p.id} className={`jersey role-${p.role} ${d.player_id === p.id ? 'is-selected' : ''}`}
            onClick={() => setDraft({ ...d, player_id: p.id, jersey: p.number })}>
            <span className="jersey-num">{p.number ?? '–'}</span>
            <span className="jersey-name">{p.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      <span className="pad-group-label">2 · What was it?</span>
      <ActionPicker value={d.action} onPick={(code) => setDraft({ ...d, action: code, value: code === 'receive' ? d.value : null,
        stage: ACTION_BY_CODE[code].court === 'path' && !d.from ? 'from' : 'to' })} />
      <button className="btn-ghost small" onClick={() => onEdit(ev)}>More (time, grade, team actions)…</button>

      {def?.court ? (
        <>
          <span className="pad-group-label">
            {first ? `3 · ${def.fromPrompt} (tap)` : `${def.court === 'path' ? 4 : 3} · ${def.toPrompt}`} {!first && <small className="muted">(tap = save)</small>}
          </span>
          {d.action === 'receive' && (
            <div className="pad-grid pad-grid-4 receive-quick">
              {[0, 1, 2, 3].map((v) => (
                <button key={v} className={`act act-receive r${v}`} onClick={() => save({ value: v })}>{v}</button>
              ))}
            </div>
          )}
          <div className="review-court">
            <CourtFull sideways="auto" showTarget={d.action === 'receive' && !first} from={d.from} to={point} label={first ? def.fromPrompt : def.toPrompt}
              onPick={(p) => (first ? setDraft({ ...d, from: p, stage: 'to' }) : save(courtFields(d.action, d.from, p)))} />
          </div>
          {first && (
            <button className="btn wide" onClick={() => setDraft({ ...d, stage: 'to' })}>
              {d.from ? 'Keep the white spot' : 'Skip: not sure where from'}
            </button>
          )}
          <div className="review-actions">
            <button className="btn btn-danger" onClick={() => remove(ev)}>✕ Not a touch</button>
            <button className="btn" onClick={() => save()}>{point || d.from ? '✓ Save with marked spots' : '✓ Save without spot'}</button>
          </div>
        </>
      ) : (
        <div className="review-actions">
          <button className="btn btn-danger" onClick={() => remove(ev)}>✕ Not a touch</button>
          <button className="btn btn-primary" onClick={() => save()}>✓ Save</button>
        </div>
      )}

      <button className="btn-ghost small" onClick={() => { if (confirm_(`Save all ${events.length} remaining suggestions as they are?`)) confirmAll(); }}>
        Save all remaining as they are
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
