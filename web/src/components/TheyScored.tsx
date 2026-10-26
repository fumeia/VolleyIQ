import { useState } from 'react';
import type { Player } from '../lib/api';
import type { Pt } from '../lib/court';
import { SpotSheet, useBelowVideo } from './SpotSheet';

/** How the opponent won the rally. 'error' = our last tag becomes our error (as before). */
export type TheirKind = 'error' | 'attack' | 'ace' | 'block' | 'other';
export interface TheyScoredResult { kind: TheirKind; at: Pt | null; playerId: number | null }

/** Kept in opp_point's value when no player of ours touched the ball (null = not said). */
export const OPP_POINT_VALUE: Partial<Record<TheirKind, number>> = { attack: 1, block: 2, ace: 3 };

/**
 * "They won": how they scored, where the ball landed and who of ours last touched it,
 * so the stats can tell their kills and aces from our own errors. Every step can be skipped.
 */
export function TheyScored({ errorLabel, players, onCourt, flip, onDone, onCancel }: {
  /** "Attack error by #7" when the last tag can become our error; null otherwise. */
  errorLabel: string | null;
  players: Player[]; onCourt?: number[]; flip?: boolean;
  onDone: (r: TheyScoredResult) => void; onCancel: () => void;
}) {
  const box = useBelowVideo();
  const [kind, setKind] = useState<TheirKind | null>(null);
  const [at, setAt] = useState<Pt | null | undefined>(undefined);

  if (kind === 'attack' || kind === 'ace') {
    if (at === undefined) {
      return (
        <SpotSheet title={kind === 'ace' ? 'Their ace' : 'Their attack'} prompt="Where did the ball land on our side?" flip={flip}
          onPick={setAt} skipLabel="Skip spot" onSkip={() => setAt(null)} onBack={() => setKind(null)} />
      );
    }
    const rank = (id: number) => { const i = onCourt?.indexOf(id) ?? -1; return i < 0 ? 99 : i; };
    const roster = players.filter((p) => p.active).sort((a, b) => rank(a.id) - rank(b.id) || (a.number ?? 99) - (b.number ?? 99));
    return (
      <div className="spot-sheet they-sheet" style={{ top: box.top, left: box.left }}>
        <div className="spot-head"><b>{kind === 'ace' ? 'Their ace' : 'Their attack'}</b> · {kind === 'ace' ? 'Who was it served at?' : 'Who of ours touched it last?'}</div>
        <div className="pad-grid pad-players small-jerseys">
          {roster.map((p) => (
            <button key={p.id} className={`jersey role-${p.role} ${onCourt?.length && !onCourt.includes(p.id) ? 'bench' : ''}`} onClick={() => onDone({ kind, at, playerId: p.id })}>
              <span className="jersey-num">{p.number ?? '–'}</span>
              <span className="jersey-name">{p.name.split(' ')[0]}</span>
            </button>
          ))}
        </div>
        <div className="spot-actions">
          <button className="btn" onClick={() => setAt(undefined)}>◀ Back</button>
          <button className="btn" onClick={() => onDone({ kind, at, playerId: null })}>Nobody touched it</button>
        </div>
      </div>
    );
  }

  return (
    <div className="spot-sheet they-sheet" style={{ top: box.top, left: box.left }}>
      <div className="spot-head"><b>They won</b> · how did they score?</div>
      <div className="they-options">
        {errorLabel && <button className="btn they-error" onClick={() => onDone({ kind: 'error', at: null, playerId: null })}>Our error <small>{errorLabel}</small></button>}
        <button className="btn" onClick={() => setKind('attack')}>Their attack <small>kill, tip, or a dig we could not keep up</small></button>
        <button className="btn" onClick={() => setKind('ace')}>Their ace <small>serve we could not pass</small></button>
        <button className="btn" onClick={() => onDone({ kind: 'block', at: null, playerId: null })}>Their block <small>our attack blocked down</small></button>
        <button className="btn" onClick={() => onDone({ kind: 'other', at: null, playerId: null })}>Other / not sure</button>
      </div>
      <div className="spot-actions"><button className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
