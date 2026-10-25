import { useRef, useState } from 'react';
import { actionLabel, ACTION_BY_CODE } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import { findIssues } from '../lib/quality';
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
  /** Move the selected events to another set (keeps everything else intact). */
  onSetMany?: (list: VEvent[], setNo: number) => Promise<void>;
  /** Show filters (set, player, kind of touch) above the list. */
  filterable?: boolean;
  /** Play the listed (filtered) events one after another as short clips. */
  onPlayAll?: (list: VEvent[]) => void;
}

const KINDS: { label: string; codes: string[] }[] = [
  { label: 'Serve', codes: ['serve', 'ace', 'serve_error'] },
  { label: 'Pass', codes: ['receive'] },
  { label: 'Set', codes: ['set', 'assist', 'assist_error', 'set_error'] },
  { label: 'Attack', codes: ['attack', 'kill', 'attack_error', 'attack_blocked'] },
  { label: 'Block', codes: ['block_touch', 'block_point', 'block_error'] },
  { label: 'Defence', codes: ['dig', 'dig_error', 'freeball'] },
  { label: 'Team', codes: ['opp_error', 'opp_point'] },
];

const HOLD_MS = 450;

export function playerLabel(players: Player[], e: VEvent) {
  const p = e.player_id != null ? players.find((x) => x.id === e.player_id) : null;
  if (p) return `#${p.number ?? '–'} ${p.name.split(' ')[0]}`;
  if (e.jersey != null) return `#${e.jersey} ?`;
  return ACTION_BY_CODE[e.action]?.needsPlayer === false ? 'Team' : '–';
}

type Sort = 'added-desc' | 'added-asc' | 'time-asc' | 'time-desc';
const SORTS: { v: Sort; label: string }[] = [
  { v: 'added-desc', label: 'Newest added' },
  { v: 'added-asc', label: 'Oldest added' },
  { v: 'time-asc', label: 'Video time ↑' },
  { v: 'time-desc', label: 'Video time ↓' },
];
// Pending (not-yet-saved) events have negative ids but are the most recent, so
// rank them above saved ones when sorting by what was added last.
const addedKey = (e: VEvent) => (e.id < 0 ? 1e12 - e.id : e.id);

export function EventList({ events, players, onSeek, onEdit, activeId, limit, onDeleteMany, onSetMany, filterable, onPlayAll }: Props) {
  const [fSet, setFSet] = useState<number | null>(null);
  const [fPlayer, setFPlayer] = useState<number | null>(null);
  const [fKind, setFKind] = useState<string | null>(null);
  const [fIssues, setFIssues] = useState(false);
  const [sort, setSort] = useState<Sort>('added-desc');
  const kind = KINDS.find((k) => k.label === fKind);
  const issues = findIssues(events);
  const filtered = events.filter((e) => (fSet == null || (e.set_no ?? 1) === fSet)
    && (fPlayer == null || e.player_id === fPlayer) && (!kind || kind.codes.includes(e.action))
    && (!fIssues || issues.size === 0 || issues.has(e.id)));
  const cmp: Record<Sort, (a: VEvent, b: VEvent) => number> = {
    'added-desc': (a, b) => addedKey(b) - addedKey(a),
    'added-asc': (a, b) => addedKey(a) - addedKey(b),
    'time-asc': (a, b) => (a.t ?? 0) - (b.t ?? 0) || addedKey(a) - addedKey(b),
    'time-desc': (a, b) => (b.t ?? 0) - (a.t ?? 0) || addedKey(b) - addedKey(a),
  };
  // The small recent list (limit, not filterable) keeps its by-time order; the full
  // Events tab honours the chosen sort.
  const shown = limit ? [...filtered].sort(cmp['time-asc']).slice(-limit).reverse() : [...filtered].sort(cmp[sort]);
  const sets = [...new Set(events.map((e) => e.set_no ?? 1))].sort();
  const people = players.filter((p) => events.some((e) => e.player_id === p.id));
  const filters = filterable && events.length > 0 && (
    <div className="ev-filters">
      {sets.length > 1 && (
        <select className="input small-select" value={fSet ?? ''} onChange={(e) => setFSet(e.target.value ? Number(e.target.value) : null)}>
          <option value="">All sets</option>
          {sets.map((n) => <option key={n} value={n}>Set {n}</option>)}
        </select>
      )}
      <select className="input small-select" value={fPlayer ?? ''} onChange={(e) => setFPlayer(e.target.value ? Number(e.target.value) : null)}>
        <option value="">All players</option>
        {people.map((p) => <option key={p.id} value={p.id}>#{p.number ?? '–'} {p.name}</option>)}
      </select>
      <select className="input small-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} title="Sort order">
        {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
      </select>
      <div className="chips tight">
        {KINDS.map((k) => <button key={k.label} className={`chip ${fKind === k.label ? 'on' : ''}`} onClick={() => setFKind(fKind === k.label ? null : k.label)}>{k.label}</button>)}
        {issues.size > 0 && <button className={`chip chip-warn ${fIssues ? 'on' : ''}`} onClick={() => setFIssues(!fIssues)}>⚠ Check ({issues.size})</button>}
      </div>
      {(fSet != null || fPlayer != null || fKind) && <span className="small muted">{filtered.length} of {events.length}</span>}
      {onPlayAll && filtered.some((e) => e.t != null) && (
        <button className="btn small" onClick={() => onPlayAll(filtered.filter((e) => e.t != null))}>▶ Play these ({filtered.filter((e) => e.t != null).length})</button>
      )}
    </div>
  );
  // null = normal list; a set = selecting (tap toggles).
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const hold = useRef<number | undefined>(undefined);
  const held = useRef(false);
  if (!shown.length) return <>{filters}<p className="muted small">{events.length ? 'Nothing matches the filters.' : 'No events yet.'}</p></>;

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
      {filters}
      {onDeleteMany && (selected ? (
        <div className="select-bar">
          <span><b>{selected.size}</b> selected</span>
          <button className="btn-ghost small" onClick={() => setSelected(selected.size === shown.length ? new Set() : new Set(shown.map((e) => e.id)))}>
            {selected.size === shown.length ? 'None' : 'All'}
          </button>
          {onSetMany && (
            <select className="input small-select" value="" disabled={!picked.length || busy} title="Move the selected events to another set"
              onChange={async (e) => {
                const n = Number(e.target.value);
                if (!n || !picked.length) return;
                setBusy(true);
                try { await onSetMany(picked, n); setSelected(null); } finally { setBusy(false); }
              }}>
              <option value="">Move to set…</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Set {n}</option>)}
            </select>
          )}
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
            {issues.has(e.id) && <span className="ev-warn" title={issues.get(e.id)}>⚠</span>}
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
