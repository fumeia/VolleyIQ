import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Team } from '../lib/api';
import { AVERAGE_TEAM, levers, simulate, teamRates, type Lever, type Rates, type SimResult } from '../lib/simulate';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const AVG = 'avg';

/**
 * Match simulator: our team against an opponent (one tagged for scouting, or an average league
 * team), played rally by rally from both teams' side-out and break rates.
 */
export function Simulator() {
  const [params, setParams] = useSearchParams();
  const [teams, setTeams] = useState<Team[]>([]);
  const [rates, setRates] = useState<Record<string, Rates | 'loading'>>({});
  const [result, setResult] = useState<{ key: string; sim: SimResult; levers: Lever[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.teams().then(setTeams); }, []);
  const vs = params.get('vs') ?? AVG;
  const us = params.get('us') ?? String(teams.find((t) => t.sv_link && String(t.id) !== vs)?.id ?? teams.find((t) => String(t.id) !== vs)?.id ?? '');
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); if (!p.get('us') && us) p.set('us', us); setParams(p, { replace: true }); setResult(null); };

  useEffect(() => {
    for (const id of [us, vs]) {
      if (!id || id === AVG || rates[id]) continue;
      setRates((r) => ({ ...r, [id]: 'loading' }));
      api.teamReport(Number(id)).then((d) => setRates((r) => ({ ...r, [id]: teamRates(d.events, d.matches, d.players) })));
    }
  }, [us, vs]); // eslint-disable-line react-hooks/exhaustive-deps

  const ours = us ? rates[us] : undefined;
  const theirs = vs === AVG ? AVERAGE_TEAM : rates[vs];
  const ready = ours && ours !== 'loading' && theirs && theirs !== 'loading';
  const key = `${us}:${vs}`;
  const name = (id: string) => (id === AVG ? 'An average league team' : teams.find((t) => String(t.id) === id)?.name ?? '…');

  function run() {
    if (!ready) return;
    setBusy(true);
    // Let the button show "Simulating…" first: the runs take a moment.
    setTimeout(() => {
      const sim = simulate(ours, theirs);
      setResult({ key, sim, levers: levers(ours, theirs, sim) });
      setBusy(false);
    }, 30);
  }
  const res = result?.key === key ? result : null;
  const thin = useMemo(() => (ready ? [ours, theirs].some((r) => r !== AVERAGE_TEAM && r.n.receiving + r.n.serving < 60) : false), [ready, ours, theirs]);

  return (
    <div className="page sim-page">
      <header className="page-head"><h1>Match simulator</h1><span className="muted small">From the rallies you tagged</span></header>
      <div className="sim-pick">
        <label>Us<select className="input" value={us} onChange={(e) => set('us', e.target.value)}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
        <span className="muted">vs</span>
        <label>Opponent<select className="input" value={vs} onChange={(e) => set('vs', e.target.value)}>
          <option value={AVG}>An average league team</option>
          {teams.filter((t) => String(t.id) !== us).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
      </div>

      <div className="sim-teams">
        {[us, vs].map((id, i) => {
          const r = id === AVG ? AVERAGE_TEAM : rates[id];
          return (
            <div key={i} className="card sim-team">
              <b>{name(id)}</b>
              {!r || r === 'loading' ? <span className="muted small">Loading…</span> : r === AVERAGE_TEAM ? (
                <span className="small muted">Side-out 58%, break 42%: typical for an amateur league.</span>
              ) : (
                <>
                  <span className="small">Side-out <b>{pct(r.overall.sideout)}</b> · break <b>{pct(r.overall.brk)}</b></span>
                  <span className="small muted">{r.n.receiving + r.n.serving} rallies{r.byRotation ? ', per rotation' : ', no line-ups (same in every rotation)'}</span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <button className="btn btn-primary" disabled={!ready || busy} onClick={run}>{busy ? 'Simulating…' : res ? 'Simulate again' : 'Simulate the match'}</button>
      {thin && <p className="small muted">Few rallies tagged: the rates are pulled towards a typical league team until there are more. Treat the numbers as a first estimate.</p>}

      {res && ready && (
        <>
          <div className="print-kpis sim-kpis">
            <div><span>Match</span><b>{pct(res.sim.match)}</b><small>chance to win (best of 5)</small></div>
            <div><span>A set</span><b>{pct(res.sim.setWin)}</b><small>to 25, best start</small></div>
            <div><span>Tie-break</span><b>{pct(res.sim.tieBreakWin)}</b><small>to 15</small></div>
          </div>

          <section className="card">
            <h2>Starting rotation</h2>
            {ours.byRotation ? (
              <>
                <p className="small">Start with the setter in <b>position {res.sim.best}</b>: it wins the most sets against {name(vs)}.</p>
                <div className="sim-bars" role="table" aria-label="Set win chance by starting rotation">
                  {res.sim.byStart.map((p, i) => (
                    <div key={i} role="row" className={`sim-bar ${i + 1 === res.sim.best ? 'on' : ''}`}>
                      <span role="cell">Setter in {i + 1}</span>
                      <span role="cell" className="sim-bar-track"><span style={{ width: `${Math.round(p * 100)}%` }} /></span>
                      <b role="cell">{pct(p)}</b>
                    </div>
                  ))}
                </div>
                <p className="small muted">Set win chance per start, against any start of theirs. The first rotations of a set get the most rallies, so starting in a strong one pays off.</p>
              </>
            ) : <p className="small muted">Enter the line-ups (match page, line-up per set) to compare starting rotations: without them every rotation counts the same.</p>}
          </section>

          <section className="card">
            <h2>What helps most</h2>
            <div className="table-wrap"><table className="stat-table">
              <thead><tr><th>If we get…</th><th>Match</th><th>Change</th></tr></thead>
              <tbody>{res.levers.map((l) => (
                <tr key={l.key}><td>{l.label}<br /><small className="muted">{l.why}</small></td><td>{pct(l.match)}</td><td><b className={l.delta > 0.005 ? 'tone-good' : ''}>{l.delta >= 0 ? '+' : ''}{Math.round(l.delta * 100)}</b></td></tr>
              ))}</tbody>
            </table></div>
            <p className="small muted">The same simulation with one thing better. The biggest change is what to train for this opponent.</p>
          </section>
          {vs !== AVG && <p className="small"><Link to={`/teams/${vs}/scouting`}>Scouting report on {name(vs)}</Link></p>}
        </>
      )}
    </div>
  );
}
