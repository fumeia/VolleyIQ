import { useState } from 'react';
import type { Match, Player, Practice } from '../lib/api';

type Pick = 'a' | 'b' | null;

/**
 * Practice match: the two sides of a set, both from our roster. Each player has a row with
 * Near / Far / Out. Each set starts from the set before.
 */
export function PracticeSheet({ match, players, set, onSave, onClose }: {
  match: Match; players: Player[]; set: number;
  onSave: (practice: Practice) => Promise<void>; onClose: () => void;
}) {
  const p = match.practice ?? { names: { a: 'Near', b: 'Far' }, sets: {} };
  const prev = p.sets[String(set)] ?? p.sets[String(set - 1)] ?? null;
  const names = p.names;
  const [pick, setPick] = useState<Record<number, Pick>>(() => {
    const m: Record<number, Pick> = {};
    for (const id of prev?.a ?? []) m[id] = 'a';
    for (const id of prev?.b ?? []) m[id] = 'b';
    return m;
  });
  // The first side plays the near half (bottom of the court as you see it): "Near" and "Far" by default.
  const near = p.sets[String(set)]?.near ?? 'a';
  const [busy, setBusy] = useState(false);
  const roster = players.filter((x) => x.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const of = (k: 'a' | 'b') => roster.filter((x) => pick[x.id] === k).map((x) => x.id);
  const swap = () => setPick((m) => Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v === 'a' ? 'b' : v === 'b' ? 'a' : null])));

  async function save() {
    setBusy(true);
    try {
      await onSave({ names, sets: { ...p.sets, [String(set)]: { a: of('a'), b: of('b'), near } } });
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet practice-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sides for this set">
        <div className="sheet-head"><b>Set {set}: who plays on which side</b><button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <p className="small muted">For each player: <b>{names.a}</b> (near half, bottom), <b>{names.b}</b> (far half, top) or <b>Out</b> (not playing this set).{prev && !p.sets[String(set)] ? ` Filled in from set ${set - 1}.` : ''}</p>
        <div className="practice-list">
          {roster.map((x) => (
            <div key={x.id} className="practice-row">
              <span className="practice-who"><b>#{x.number ?? '–'}</b> {x.name.split(' ')[0]}</span>
              <span className="segmented practice-choice" role="radiogroup" aria-label={`Side of #${x.number ?? '–'} ${x.name}`}>
                {([['a', names.a], ['b', names.b], [null, 'Out']] as [Pick, string][]).map(([k, label]) => (
                  <button key={label} role="radio" aria-checked={(pick[x.id] ?? null) === k} className={`${(pick[x.id] ?? null) === k ? 'on' : ''} ${k ? `side-${k}` : ''}`}
                    onClick={() => setPick((m) => ({ ...m, [x.id]: k }))}>{label}</button>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="small muted">You tap every spot where it happened, as you see it; for the analysis the far side's spots are turned around to its own half, so all players' actions end up on the same side.</p>
        <div className="row wrap">
          <span className="small"><b>{names.a}</b> {of('a').length} · <b>{names.b}</b> {of('b').length}</span>
          <button className="btn-ghost small" onClick={swap}>Swap near and far</button>
        </div>
        <button className="btn btn-primary" disabled={busy || !of('a').length || !of('b').length} onClick={save}>{busy ? 'Saving…' : `Save the sides of set ${set}`}</button>
      </div>
    </div>
  );
}
