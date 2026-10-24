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
}

export function playerLabel(players: Player[], e: VEvent) {
  const p = e.player_id != null ? players.find((x) => x.id === e.player_id) : null;
  if (p) return `#${p.number ?? '–'} ${p.name.split(' ')[0]}`;
  if (e.jersey != null) return `#${e.jersey} ?`;
  return ACTION_BY_CODE[e.action]?.needsPlayer === false ? 'Team' : '—';
}

export function EventList({ events, players, onSeek, onEdit, activeId, limit }: Props) {
  const shown = limit ? events.slice(-limit).reverse() : events;
  if (!shown.length) return <p className="muted small">No events yet.</p>;
  return (
    <ul className="evlist">
      {shown.map((e) => {
        const group = ACTION_BY_CODE[e.action]?.group ?? 'actions';
        return (
          <li key={e.id} className={`ev ${e.status === 'suggested' ? 'ev-suggested' : ''} ${activeId === e.id ? 'ev-active' : ''}`}>
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
  );
}
