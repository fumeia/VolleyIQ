import { useMemo, useState } from 'react';
import { scoreOf } from '../lib/actions';
import type { Match, Player, VEvent } from '../lib/api';
import { gapOptions, type Pt } from '../lib/gap';
import { scoreBySet } from '../lib/stats';

const pointsOf = (events: VEvent[], set: number): Pt[] =>
  events.filter((e) => (e.set_no ?? 1) === set).map((e) => scoreOf(e)).filter((s): s is Pt => !!s);

/**
 * Back to tagging after a break (e.g. on court for a few points): the score now, per set if a set
 * ended meanwhile, who serves and (with a line-up) our rotation. The missing points are added as
 * untagged points, in an order that leaves the court as it is now.
 */
export function ResumeSheet({ match, players, confirmed, setNo, onSave, onClose }: {
  match: Match; players: Player[]; confirmed: VEvent[]; setNo: number;
  onSave: (gaps: { set: number; points: Pt[] }[], setNow: number) => Promise<void>; onClose: () => void;
}) {
  const tagged = useMemo(() => scoreBySet(confirmed), [confirmed]);
  const scoreOfSet = (s: number) => tagged.find((x) => x.set === s) ?? { set: s, us: 0, them: 0 };
  const [setNow, setSetNow] = useState(setNo);
  const [scores, setScores] = useState<Record<number, { us: number; them: number }>>({});
  const get = (s: number) => scores[s] ?? { us: scoreOfSet(s).us, them: scoreOfSet(s).them };
  const put = (s: number, side: 'us' | 'them', v: number) => setScores((m) => ({ ...m, [s]: { ...get(s), [side]: Math.max(side === 'us' ? scoreOfSet(s).us : scoreOfSet(s).them, v) } }));
  const before = pointsOf(confirmed, setNow);
  const last = before[before.length - 1];
  const [serve, setServe] = useState<'us' | 'them' | null>(null);
  const weServe = (serve ?? (last ?? (match.lineups?.[String(setNow)]?.weServeFirst === false ? 'them' : 'us'))) === 'us';
  const lineup = match.lineups?.[String(setNow)] ?? null;
  const now = get(setNow);
  const missing = { us: now.us - scoreOfSet(setNow).us, them: now.them - scoreOfSet(setNow).them };
  const options = useMemo(
    () => gapOptions(missing.us, missing.them, before, null, lineup, players, weServe),
    [missing.us, missing.them, before.length, lineup, players, weServe], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [pick, setPick] = useState(0);
  const chosen = options[Math.min(pick, options.length - 1)];
  const [busy, setBusy] = useState(false);
  const label = (o: (typeof options)[number]) => {
    const p1 = players.find((p) => p.id === o.inOne);
    return o.setter ? `Setter in ${o.setter}${p1 ? ` · #${p1.number} in position 1` : ''}` : p1 ? `#${p1.number} in position 1` : 'This rotation';
  };
  const sets = Array.from({ length: setNow - setNo + 1 }, (_, i) => setNo + i);
  const ended = (s: number) => { const x = get(s); return Math.max(x.us, x.them) >= (s === 5 ? 15 : 25) && Math.abs(x.us - x.them) >= 2; };
  const okEnded = sets.slice(0, -1).every(ended);

  async function save() {
    if (!chosen) return;
    setBusy(true);
    const gaps: { set: number; points: Pt[] }[] = [];
    for (const s of sets.slice(0, -1)) {
      const x = get(s), t = scoreOfSet(s);
      const u = x.us - t.us, h = x.them - t.them;
      // A finished set: the winner took the last point; the order inside does not matter any more.
      const o = gapOptions(u, h, pointsOf(confirmed, s), null, null, players, x.us > x.them)[0];
      if (o) gaps.push({ set: s, points: o.points });
    }
    gaps.push({ set: setNow, points: chosen.points });
    try { await onSave(gaps.filter((g) => g.points.length), setNow); } finally { setBusy(false); }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet resume-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Resume tagging">
        <div className="sheet-head"><b>Back to tagging</b><button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <p className="small muted">Enter the score as it is now. The points you missed are added as untagged points: they count for the score, not for the stats.</p>
        <div className="row wrap">
          <span className="small">Set now</span>
          <button className="btn small" disabled={setNow <= setNo} onClick={() => { setSetNow(setNow - 1); setPick(0); }}>−</button>
          <b>{setNow}</b>
          <button className="btn small" disabled={setNow >= 5} onClick={() => { setSetNow(setNow + 1); setPick(0); }}>+</button>
        </div>
        {sets.map((s) => (
          <div key={s} className="resume-score">
            <span className="small">{s < setNow ? `Set ${s} ended` : `Score now${setNow !== setNo ? ` (set ${s})` : ''}`}</span>
            {(['us', 'them'] as const).map((side) => (
              <span key={side} className="resume-stepper">
                <small className="muted">{side === 'us' ? (match.team_name ?? 'Us') : (match.opponent ?? 'Them')}</small>
                <button className="btn small" onClick={() => { put(s, side, get(s)[side] - 1); setPick(0); }} aria-label={`${side} minus one`}>−</button>
                <input className="input slim" inputMode="numeric" value={get(s)[side]} aria-label={side === 'us' ? 'Our points' : 'Their points'}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) { put(s, side, v); setPick(0); } }} />
                <button className="btn small" onClick={() => { put(s, side, get(s)[side] + 1); setPick(0); }} aria-label={`${side} plus one`}>+</button>
              </span>
            ))}
          </div>
        ))}
        {!okEnded && <p className="small error">A set that ended needs its final score (25 or 15, two points ahead).</p>}
        <div className="row wrap">
          <span className="small">Serving now</span>
          <button className={`chip ${weServe ? 'on' : ''}`} onClick={() => { setServe('us'); setPick(0); }}>Us</button>
          <button className={`chip ${!weServe ? 'on' : ''}`} onClick={() => { setServe('them'); setPick(0); }}>Them</button>
        </div>
        {lineup && options.length > 1 && (
          <div className="resume-rot">
            <span className="small">Our rotation now</span>
            <div className="chips">{options.map((o, i) => <button key={i} className={`chip ${chosen === o ? 'on' : ''}`} onClick={() => setPick(i)}>{label(o)}</button>)}</div>
          </div>
        )}
        {!chosen && <p className="small error">That cannot happen: check who serves (the team that won the last point serves).</p>}
        <button className="btn btn-primary" disabled={busy || !chosen || !okEnded} onClick={save}>
          {busy ? 'Saving…' : `Resume at ${now.us} : ${now.them}`}
        </button>
      </div>
    </div>
  );
}
