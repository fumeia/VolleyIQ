import { ACTION_BY_CODE } from '../lib/actions';
import type { EditFields, EditSuggestion, Player, VEvent } from '../lib/api';
import { fmtTime } from './TagPad';

interface Props {
  edits: EditSuggestion[];
  players: Player[];
  busy: number | null;
  onWatch: (t: number) => void;
  onDecide: (s: EditSuggestion, decision: 'accept' | 'reject') => void;
}

const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(`${iso.replace(' ', 'T')}Z`).getTime()) / 60000);
  return min < 60 ? `${Math.max(1, min)} min ago` : min < 1440 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
};

/**
 * Corrections sent by viewers of the public link (Replays tab): what they would change
 * on a tag, to accept (the tag is updated) or reject. Nothing changes before that.
 */
export function EditsPanel({ edits, players, busy, onWatch, onDecide }: Props) {
  const who = (id: number | null | undefined) => {
    if (id == null) return 'nobody';
    const p = players.find((x) => x.id === id);
    return p ? `#${p.number ?? '–'} ${p.name.split(' ')[0]}` : '?';
  };
  const spot = (f: EditFields) => (f.x != null ? `${f.fx != null ? `${f.fx.toFixed(1)}, ${f.fy!.toFixed(1)} → ` : ''}${f.x.toFixed(1)}, ${f.y!.toFixed(1)} m` : 'none');
  /** Each changed field as "before → after". */
  const rows = (s: EditSuggestion) => {
    const c = s.changes, o = s.original, out: [string, string, string][] = [];
    if ('player_id' in c) out.push(['Player', who(o.player_id), who(c.player_id)]);
    if ('action' in c) out.push(['Action', ACTION_BY_CODE[o.action!]?.label ?? String(o.action), ACTION_BY_CODE[c.action!]?.label ?? String(c.action)]);
    if ('value' in c) out.push(['Grade', o.value == null ? '–' : String(o.value), c.value == null ? '–' : String(c.value)]);
    if (['x', 'y', 'fx', 'fy'].some((k) => k in c)) out.push(['Court spot', spot(o), spot({ ...o, ...c })]);
    return out;
  };
  /** The tag was changed since the suggestion was sent (or deleted). */
  const changedSince = (s: EditSuggestion, e: VEvent | null) =>
    !e ? 'The tag was deleted since.' : (Object.keys(s.original) as (keyof EditFields)[]).some((k) => (e[k] ?? null) !== (s.original[k] ?? null))
      ? 'You changed this tag since it was sent.' : null;

  /** "from #9 Dana, " (the roster name when the number is on it). */
  const sender = (s: EditSuggestion) => {
    if (s.sender_jersey == null) return s.name ? `${s.name}, ` : '';
    const p = players.find((x) => x.number === s.sender_jersey && x.active);
    return `from #${s.sender_jersey}${p ? ` ${p.name.split(' ')[0]}` : ''}, `;
  };

  if (!edits.length) return <div className="pad muted">No corrections waiting.</div>;
  return (
    <div className="pad edits-panel">
      <p className="small muted">Corrections from people watching the replays on the public link. Accept to change the tag, reject to drop it.</p>
      {edits.map((s) => {
        const warn = changedSince(s, s.event);
        return (
          <div key={s.id} className="edit-card">
            <div className="row between">
              <span><b>{s.event?.t != null ? fmtTime(s.event.t) : 'Touch'}</b>{s.event?.set_no ? ` · Set ${s.event.set_no}` : ''} · {who(s.event?.player_id ?? s.original.player_id)} {ACTION_BY_CODE[(s.event ?? s.original).action!]?.short ?? ''}</span>
              <span className="small muted">{sender(s)}{ago(s.created_at)}</span>
            </div>
            {rows(s).length > 0 && (
              <table className="edit-diff small"><tbody>
                {rows(s).map(([k, a, b]) => <tr key={k}><td className="muted">{k}</td><td><s>{a}</s></td><td>→ <b>{b}</b></td></tr>)}
              </tbody></table>
            )}
            {s.note && <p className="small edit-note">“{s.note}”</p>}
            {warn && <p className="small tone-bad">{warn}</p>}
            <div className="row">
              {s.event?.t != null && <button className="btn-ghost small" onClick={() => onWatch(s.event!.t!)}>▶ Watch</button>}
              <span className="grow" />
              <button className="btn small btn-danger" disabled={busy === s.id} onClick={() => onDecide(s, 'reject')}>✕ Reject</button>
              <button className="btn small btn-primary" disabled={busy === s.id || !s.event || !rows(s).length} onClick={() => onDecide(s, 'accept')}>✓ Accept</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
