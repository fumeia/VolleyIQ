import { useRef, useState } from 'react';
import { actionLabel, ACTION_BY_CODE } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import { fmtTime } from './TagPad';

interface Props {
  events: VEvent[];
  players: Player[];
  onSeek?: (t: number) => void;
  onEdit?: (e: VEvent) => void;
  activeId?: number | null;
  limit?: number;
  /** Enables selecting several events (hold one, then tap more) and deleting them at once. */
  onDeleteMany?: (list: VEvent[]) => Promise<void>;
}

const HOLD_MS = 450;

export function playerLabel(players: Player[], e: VEvent) {
  const p = e.player_id != null ? players.find((x) => x.id === e.player_id) : null;
  if (p) return `#${p.number ?? '–'} ${p.name.split(' ')[0]}`;
  if (e.jersey != null) return `#${e.jersey} ?`;
  return ACTION_BY_CODE[e.action]?.needsPlayer === false ? 'Team' : '—';
}

export function EventList({ events, players, onSeek, onEdit, activeId, limit, onDeleteMany }: Props) {
  const shown = limit ? events.slice(-limit).reverse() : events;
  // null = normal list; a set = selecting (tap toggles).
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const hold = useRef<number | undefined>(undefined);
  const held = useRef(false);
  if (!shown.length) return <p className="muted small">No events yet.</p>;

  const toggle = (id: number) => setSelected((s) => {
    const next = new Set(s ?? []);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const startHold = (id: number) => {
    if (!onDeleteMany || selected) return;
    held.current = false;
    hold.current = window.setTimeout(() => { held.current = true; setSelected(new Set([id])); navigator.vibrate?.(20); }, HOLD_MS);
  };
  const endHold = () => clearTimeout(hold.current);
  const picked = shown.filter((e) => selected?.has(e.id));

  return (
    <>
      {onDeleteMany && (selected ? (
        <div className="select-bar">
          <span><b>{selected.size}</b> selected</span>
          <button className="btn-ghost small" onClick={() => setSelected(selected.size === shown.length ? new Set() : new Set(shown.map((e) => e.id)))}>
            {selected.size === shown.length ? 'None' : 'All'}
          </button>
          <button className="btn small btn-danger" disabled={!picked.length || busy} onClick={async () => {
            setBusy(true);
            try { await onDeleteMany(picked); setSelected(null); } finally { setBusy(false); }
          }}>🗑 Delete {picked.length || ''}</button>
          <button className="btn-ghost small" onClick={() => setSelected(null)}>Cancel</button>
        </div>
      ) : (
        <div className="select-hint small muted">
          Hold an event to select several.
          <button className="btn-ghost small" onClick={() => setSelected(new Set())}>Select</button>
        </div>
      ))}
      <ul className={`evlist ${selected ? 'is-selecting' : ''}`}>
      {shown.map((e) => {
        const group = ACTION_BY_CODE[e.action]?.group ?? 'actions';
        const on = selected?.has(e.id);
        return (
          <li key={e.id} className={`ev ${e.status === 'suggested' ? 'ev-suggested' : ''} ${activeId === e.id ? 'ev-active' : ''} ${on ? 'ev-picked' : ''}`}
            onPointerDown={() => startHold(e.id)} onPointerUp={endHold} onPointerLeave={endHold} onPointerCancel={endHold}
            onContextMenu={(ev) => onDeleteMany && ev.preventDefault()}
            onClickCapture={(ev) => {
              // While selecting, a tap anywhere on the row toggles it (instead of seeking or editing).
              if (held.current) { held.current = false; ev.stopPropagation(); ev.preventDefault(); return; }
              if (selected) { ev.stopPropagation(); ev.preventDefault(); toggle(e.id); }
            }}>
            {selected && <span className={`ev-check ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>}
            <button className="ev-time" disabled={e.t == null || !onSeek} onClick={() => e.t != null && onSeek?.(e.t)}>
              {e.t != null ? fmtTime(e.t) : '·'}
            </button>
            <span className="ev-player">{playerLabel(players, e)}</span>
            <span className={`ev-action g-${group}`}>
              {actionLabel(e)}{e.zone ? ` · Z${e.zone}` : ''}
            </span>
            {e.status === 'suggested' && <span className="badge">AI {e.confidence != null ? Math.round(e.confidence * 100) + '%' : ''}</span>}
            {e.id < 0 && <span className="badge badge-pending" title="Waiting for connection">⏳</span>}
            {onEdit && <button className="ev-edit" onClick={() => onEdit(e)} aria-label="Edit">✎</button>}
          </li>
        );
      })}
      </ul>
    </>
  );
}
