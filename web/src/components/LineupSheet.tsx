import { useState } from 'react';
import type { Match, Player } from '../lib/api';
import type { Lineup, Lineups } from '../lib/rotation';

interface Props {
  match: Match;
  players: Player[];
  initialSet: number;
  onSave: (lineups: Lineups) => Promise<void>;
  onClose: () => void;
}

// Court positions as seen from behind our baseline: front row 4-3-2 at the net, back row 5-6-1.
const GRID = [4, 3, 2, 5, 6, 1];

/** Starting six per set (position 1 = server), libero and who serves first. */
export function LineupSheet({ match, players, initialSet, onSave, onClose }: Props) {
  const [all, setAll] = useState<Lineups>(() => match.lineups ?? {});
  const [set, setSet] = useState(initialSet);
  const [slot, setSlot] = useState<number | null>(1);
  const roster = players.filter((p) => p.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const empty: Lineup = { order: [null, null, null, null, null, null], libero: null, weServeFirst: true };
  const cur = all[String(set)] ?? all[String(set - 1)] ?? empty;
  const put = (l: Lineup) => setAll({ ...all, [String(set)]: l });
  const label = (id: number | null | undefined) => {
    const p = players.find((x) => x.id === id);
    return p ? `#${p.number ?? '–'} ${p.name.split(' ')[0]}` : '—';
  };

  function choose(id: number) {
    if (slot == null) return;
    // A player stands in one spot only.
    const order = cur.order.map((x) => (x === id ? null : x));
    order[slot - 1] = id;
    put({ ...cur, order, libero: cur.libero === id ? null : cur.libero });
    const next = GRID.find((p) => p !== slot && order[p - 1] == null);
    setSlot(next ?? null);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>Line-up</b><button className="btn-ghost" onClick={onClose}>✕</button></div>
        <div className="segmented">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={set === n ? 'on' : ''} onClick={() => setSet(n)}>Set {n}{all[String(n)] ? ' ✓' : ''}</button>
          ))}
        </div>
        {!all[String(set)] && set > 1 && all[String(set - 1)] && <span className="small muted">Copied from set {set - 1}; change what differs.</span>}
        <div className="lineup-court">
          <span className="lineup-net">NET</span>
          {GRID.map((pos) => (
            <button key={pos} className={`lineup-slot ${slot === pos ? 'sel' : ''}`} onClick={() => setSlot(pos)}>
              <small>{pos === 1 ? '1 · serves' : pos}</small>
              <b>{label(cur.order[pos - 1])}</b>
            </button>
          ))}
        </div>
        <label className="field-label">{slot ? `Who starts in position ${slot}?` : 'Tap a position to change it'}</label>
        <div className="chips">
          {roster.map((p) => (
            <button key={p.id} className={`chip ${cur.order.includes(p.id) ? 'on' : ''}`} disabled={!slot} onClick={() => choose(p.id)}>
              #{p.number ?? '–'} {p.name.split(' ')[0]} <small>{p.role}</small>
            </button>
          ))}
        </div>
        <label className="field-label">Libero (replaces the middles in the back row)</label>
        <div className="chips">
          <button className={`chip ${!cur.libero ? 'on' : ''}`} onClick={() => put({ ...cur, libero: null })}>None</button>
          {roster.filter((p) => !cur.order.includes(p.id)).map((p) => (
            <button key={p.id} className={`chip ${cur.libero === p.id ? 'on' : ''}`} onClick={() => put({ ...cur, libero: p.id })}>
              #{p.number ?? '–'} {p.name.split(' ')[0]}
            </button>
          ))}
        </div>
        <label className="field-label">First serve of set {set}</label>
        <div className="segmented">
          <button className={cur.weServeFirst ? 'on' : ''} onClick={() => put({ ...cur, weServeFirst: true })}>We serve</button>
          <button className={!cur.weServeFirst ? 'on' : ''} onClick={() => put({ ...cur, weServeFirst: false })}>They serve</button>
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={async () => { await onSave({ ...all, [String(set)]: cur }); onClose(); }}>Save line-up</button>
        </div>
      </div>
    </div>
  );
}
