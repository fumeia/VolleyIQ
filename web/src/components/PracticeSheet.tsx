import { useState } from 'react';
import type { Match, Player, Practice } from '../lib/api';

type Pick = 'a' | 'b' | null;

/**
 * Practice match: the two sides of a set, both from our roster. Tap a player to put them on the
 * first side, again for the second, again to leave them out. Each set starts from the set before.
 */
export function PracticeSheet({ match, players, set, onSave, onClose }: {
  match: Match; players: Player[]; set: number;
  onSave: (practice: Practice) => Promise<void>; onClose: () => void;
}) {
  const p = match.practice ?? { names: { a: 'Blue', b: 'White' }, sets: {} };
  const prev = p.sets[String(set)] ?? p.sets[String(set - 1)] ?? null;
  const [names, setNames] = useState(p.names);
  const [pick, setPick] = useState<Record<number, Pick>>(() => {
    const m: Record<number, Pick> = {};
    for (const id of prev?.a ?? []) m[id] = 'a';
    for (const id of prev?.b ?? []) m[id] = 'b';
    return m;
  });
  const [busy, setBusy] = useState(false);
  const roster = players.filter((x) => x.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const next = (v: Pick): Pick => (v == null ? 'a' : v === 'a' ? 'b' : null);
  const of = (k: 'a' | 'b') => roster.filter((x) => pick[x.id] === k).map((x) => x.id);
  const swap = () => setPick((m) => Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v === 'a' ? 'b' : v === 'b' ? 'a' : null])));

  async function save() {
    setBusy(true);
    try {
      await onSave({ names: { a: names.a.trim() || 'Blue', b: names.b.trim() || 'White' }, sets: { ...p.sets, [String(set)]: { a: of('a'), b: of('b') } } });
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet practice-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sides for this set">
        <div className="sheet-head"><b>Set {set}: who plays on which side</b><button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="row wrap practice-names">
          <label className="small">First side <input className="input slim" value={names.a} maxLength={30} onChange={(e) => setNames({ ...names, a: e.target.value })} aria-label="Name of the first side" /></label>
          <label className="small">Second side <input className="input slim" value={names.b} maxLength={30} onChange={(e) => setNames({ ...names, b: e.target.value })} aria-label="Name of the second side" /></label>
        </div>
        <p className="small muted">Tap a player: once for {names.a || 'the first side'}, twice for {names.b || 'the second side'}, a third time to leave them out.{prev && !p.sets[String(set)] ? ` Filled in from set ${set - 1}.` : ''}</p>
        <div className="practice-grid">
          {roster.map((x) => (
            <button key={x.id} className={`practice-player ${pick[x.id] ? `on-${pick[x.id]}` : ''}`} onClick={() => setPick((m) => ({ ...m, [x.id]: next(m[x.id] ?? null) }))}>
              <b>#{x.number ?? '–'}</b> {x.name.split(' ')[0]}
              <small>{pick[x.id] === 'a' ? names.a : pick[x.id] === 'b' ? names.b : 'out'}</small>
            </button>
          ))}
        </div>
        <div className="row wrap">
          <span className="small"><b>{names.a}</b> {of('a').length} · <b>{names.b}</b> {of('b').length}</span>
          <button className="btn-ghost small" onClick={swap}>Swap sides</button>
        </div>
        <button className="btn btn-primary" disabled={busy || !of('a').length || !of('b').length} onClick={save}>{busy ? 'Saving…' : `Save the sides of set ${set}`}</button>
      </div>
    </div>
  );
}
