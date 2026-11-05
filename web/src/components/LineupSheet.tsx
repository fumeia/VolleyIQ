import { useState } from 'react';
import { api, type LineupRead, type Match, type Player } from '../lib/api';
import { ourHalfAt } from '../lib/calibration';
import { GRAB_NOTE, grabPictures, grabWay } from '../lib/grab';
import type { PlayerHandle } from './VideoPlayer';
import { orderAt, type Lineup, type Lineups } from '../lib/rotation';
import { fmtTime } from './TagPad';

interface Props {
  match: Match;
  players: Player[];
  initialSet: number;
  /** Video time for a substitution (null without a video: it then counts from now on). */
  getTime: () => number | null;
  onSave: (lineups: Lineups) => Promise<void>;
  onClose: () => void;
  /** The video, to read the line-up from a frame at a serve. */
  player?: React.RefObject<PlayerHandle | null>;
  /** Whose line-up (practice match: the side's name). */
  title?: string;
  /** Practice match: who serves first in a set without a line-up yet (the opposite of the other side). */
  serveFirstFor?: (set: number) => boolean | undefined;
}

// Court positions as seen from behind our baseline: front row 4-3-2 at the net, back row 5-6-1.
const GRID = [4, 3, 2, 5, 6, 1];

/** Starting six per set (position 1 = server), libero and who serves first. */
export function LineupSheet({ match, players, initialSet, getTime, onSave, onClose, player, title, serveFirstFor }: Props) {
  const [all, setAll] = useState<Lineups>(() => match.lineups ?? {});
  const [set, setSet] = useState(initialSet);
  const [slot, setSlot] = useState<number | null>(1);
  const [subOut, setSubOut] = useState<number | null>(null);
  const now = getTime();
  const roster = players.filter((p) => p.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const empty: Lineup = { order: [null, null, null, null, null, null], libero: null, weServeFirst: true };
  // A new set starts from the previous set's six (without its substitutions).
  const prev = all[String(set - 1)];
  const serveDefault = serveFirstFor?.(set);
  const cur = all[String(set)] ?? { ...(prev ? { ...prev, subs: [] } : empty), ...(serveDefault !== undefined ? { weServeFirst: serveDefault } : {}) };
  const subs = [...(cur.subs ?? [])].sort((a, b) => a.t - b.t);
  const subAt = now ?? 1e9 + subs.length; // live tagging: after everything so far
  const onCourtNow = orderAt(cur, subAt).filter((x): x is number => x != null);
  const put = (l: Lineup) => setAll({ ...all, [String(set)]: l });
  const label = (id: number | null | undefined) => {
    const p = players.find((x) => x.id === id);
    return p ? `#${p.number ?? '–'} ${p.name.split(' ')[0]}` : '–';
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
        <div className="sheet-head"><b>Line-up{title ? ` ${title}` : ''}</b><button className="btn-ghost" onClick={onClose}>✕</button></div>
        <div className="segmented">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={set === n ? 'on' : ''} onClick={() => setSet(n)}>Set {n}{all[String(n)] ? ' ✓' : ''}</button>
          ))}
        </div>
        {!all[String(set)] && set > 1 && all[String(set - 1)] && <span className="small muted">Copied from set {set - 1}; change what differs.</span>}
        {player && <ReadLineup player={player} match={match} players={players} onApply={(l) => put({ ...cur, ...l })} />}
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
        <label className="field-label">Substitutions in set {set}</label>
        {subs.map((x) => (
          <div key={`${x.t}-${x.out}`} className="sides-row">
            <span className="small">{x.t >= 1e9 ? 'live' : fmtTime(x.t)} · {label(x.out)} ⟶ {label(x.in)}</span>
            <button className="btn-ghost small" aria-label="Remove" onClick={() => put({ ...cur, subs: subs.filter((y) => y !== x) })}>✕</button>
          </div>
        ))}
        {cur.order.every((x) => x != null) && (
          <>
            <span className="small muted">
              {now != null ? `At ${fmtTime(now)} (pause the video where the change happens): ` : ''}
              {subOut == null ? 'who goes out?' : `${label(subOut)} goes out. Who comes in?`}
            </span>
            <div className="chips">
              {subOut == null
                ? onCourtNow.map((id) => <button key={id} className="chip" onClick={() => setSubOut(id)}>{label(id)}</button>)
                : <>
                  {roster.filter((p) => !onCourtNow.includes(p.id) && p.id !== cur.libero).map((p) => (
                    <button key={p.id} className="chip" onClick={() => {
                      put({ ...cur, subs: [...subs, { t: subAt, out: subOut, in: p.id }] });
                      setSubOut(null);
                    }}>{label(p.id)}</button>
                  ))}
                  <button className="chip" onClick={() => setSubOut(null)}>Cancel</button>
                </>}
            </div>
          </>
        )}
        <label className="field-label">First serve of set {set}</label>
        <div className="segmented">
          <button className={cur.weServeFirst ? 'on' : ''} onClick={() => put({ ...cur, weServeFirst: true })}>{title ? `${title} serves` : 'We serve'}</button>
          <button className={!cur.weServeFirst ? 'on' : ''} onClick={() => put({ ...cur, weServeFirst: false })}>{title ? 'The other side serves' : 'They serve'}</button>
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={async () => { await onSave({ ...all, [String(set)]: cur }); onClose(); }}>Save line-up</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Reads the line-up from the frame on screen (at the first serve of a set): the whole frame
 * and its four quarters go to the AI, which says who stands where for both teams. Our team
 * is the one on our half of the court marking; the result fills the set's line-up to check.
 */
function ReadLineup({ player, match, players, onApply }: {
  player: React.RefObject<PlayerHandle | null>; match: Match; players: Player[]; onApply: (l: Partial<Lineup>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<LineupRead[] | null>(null);
  const [first, setFirst] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const way = grabWay(player.current);
  const at = player.current?.time() ?? 0;
  const ours = match.calibration ? ourHalfAt(match.calibration, at) : null;
  const byNumber = (n: number | null) => (n == null ? null : players.find((p) => p.active && p.number === n) ?? null);

  async function read() {
    setBusy(true); setError(''); setNote(''); setTeams(null);
    try {
      const g = await grabPictures(player.current!, ['whole', 'quarters']);
      const r = await api.readLineup(g.data.flat().map((data) => ({ media_type: 'image/jpeg', data })));
      setTeams(r.teams);
      if (!r.teams.length) setError('No line-up could be read. Try a frame closer to the serve, with all players in view.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  function apply(team: LineupRead) {
    const order: (number | null)[] = [null, null, null, null, null, null];
    let libero: number | null | undefined;
    const missing: number[] = [];
    for (const p of team.players) {
      const pl = byNumber(p.number);
      if (p.number != null && !pl) missing.push(p.number);
      if (!pl) continue;
      // The libero stands in for a middle in the back row: the line-up keeps that spot for the player it replaces.
      if (p.libero) { libero = pl.id; continue; }
      if (p.position) order[p.position - 1] = pl.id;
    }
    onApply({ order, ...(libero !== undefined ? { libero } : {}), ...(first ? { weServeFirst: team.serving } : {}) });
    const empty = order.filter((x) => x == null).length;
    setNote([
      empty ? `${empty} position${empty === 1 ? '' : 's'} still empty${libero ? ' (one is where the libero stood: put the player the libero replaced there)' : ''}.` : 'All six filled in.',
      missing.length ? `Not on the roster: ${missing.map((n) => `#${n}`).join(', ')}.` : '',
      'Check it against the video before saving.',
    ].filter(Boolean).join(' '));
    setTeams(null);
  }

  if (!way) return null;
  return (
    <div className="read-lineup">
      <div className="row wrap">
        <button className="btn" disabled={busy} onClick={read}>{busy ? 'Reading the line-up…' : 'Read from the video'}</button>
        <label className="toggle small"><input type="checkbox" checked={first} onChange={(e) => setFirst(e.target.checked)} /> first serve of the set</label>
      </div>
      {!teams && !note && <span className="small muted">Pause at the first serve of the set, all players in view (zoom out), then read.{GRAB_NOTE[way] && ` ${GRAB_NOTE[way]}`}</span>}
      {teams && teams.length > 0 && (
        <div className="read-lineup-teams">
          <span className="small">Which team is {match.team_name ?? 'yours'}?</span>
          {teams.map((t, i) => (
            <button key={i} className={`btn ${t.side && t.side === ours ? 'btn-primary' : ''}`} onClick={() => apply(t)}>
              {t.shirt}{t.side ? ` · ${t.side} side` : ''}{t.serving ? ' · serving' : ''}
              <small> ({t.players.filter((p) => p.position).sort((a, b) => a.position! - b.position!).map((p) => `${p.position}: ${p.number ?? '?'}`).join(', ')})</small>
            </button>
          ))}
        </div>
      )}
      {note && <span className="small">{note}</span>}
      {error && <span className="small error">{error}</span>}
    </div>
  );
}
