import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { api, type Match, type Player, type Team, type VEvent } from '../lib/api';
import { printPage } from '../lib/native';
import { MIN, scoutingReport, type Distribution, type ScoutingReport as Report } from '../lib/scouting';
import { breakPct, sideOutPct } from '../lib/analysis';
import { ServeTargets } from '../components/ServeTargets';

const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const eff = (v: number) => `${v > 0.0005 ? '+' : ''}${v.toFixed(3).replace(/^(-?)0\./, '$1.')}`;
const who = (p: Player) => <><b>#{p.number ?? '?'}</b>{p.name && !/^#?\d+$/.test(p.name.trim()) ? ` ${p.name}` : ''}{p.role ? <small> {p.role}</small> : null}</>;
const ORIGIN: Record<string, string> = { '4': '4', '3': '3', '2': '2', b5: 'back 5', b6: 'pipe', b1: 'back 1' };

/**
 * Scouting report on a team from the matches tagged for it: the game plan in a few lines,
 * then the tables behind it. Prints on A4 (Save as PDF).
 */
export function ScoutingReport() {
  const { id } = useParams();
  const [data, setData] = useState<{ team: Team; players: Player[]; matches: Match[]; events: VEvent[] } | null>(null);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  useEffect(() => { api.teamReport(Number(id)).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed')); }, [id]);
  const report = useMemo(() => (data ? scoutingReport(data.players, data.events, data.matches) : null), [data]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data || !report) return <div className="page"><p className="muted">Loading…</p></div>;
  const tagged = data.matches.filter((m) => data.events.some((e) => e.match_id === m.id && e.status === 'confirmed'));
  const body = <ScoutingBody team={data.team} matches={tagged} report={report} />;
  return (
    <div className="page">
      <header className="page-head">
        <h1>Scouting: {data.team.name}</h1>
        <div className="row">
          <Link className="btn-ghost small" to={`/teams/${data.team.id}`}>Team page</Link>
          <Link className="btn-ghost small" to={`/simulate?vs=${data.team.id}`}>Simulate a match</Link>
          {report.rallies > 0 && <button className="btn small" onClick={() => setPrinting(true)}>Save as PDF / print</button>}
        </div>
      </header>
      {report.rallies === 0 ? (
        <div className="card">
          <p>No tagged matches for {data.team.name} yet.</p>
          <p className="small muted">
            Find one of their games with a video (Matches, or the opponent's page from your schedule), open it and pick "Tag this video for {data.team.name}".
            Tag their touches like your own: serves, passes, sets and attacks with where they went. Two or three matches give a useful report.
          </p>
        </div>
      ) : <div className="scout-report">{body}</div>}
      {printing && createPortal(
        <div className="print-root">
          <div className="print-bar no-print">
            <button className="btn btn-primary" onClick={() => printPage(`Scouting ${data.team.name}`)}>Save as PDF / print</button>
            <button className="btn" onClick={() => setPrinting(false)}>Close</button>
          </div>
          <div className="print-page">{body}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function ScoutingBody({ team, matches, report: r }: { team: Team; matches: Match[]; report: Report }) {
  const recv = r.receivers.filter((x) => x.n >= 3);
  const hitters = r.attackers.filter((x) => x.attempts >= 3);
  const servers = r.servers.filter((x) => x.n >= 3);
  return (
    <>
      <div className="print-head">
        <div>
          <h1>{team.name}</h1>
          <p>Scouting report from {matches.length} tagged match{matches.length === 1 ? '' : 'es'}, {r.sets} sets, {r.rallies} rallies</p>
        </div>
        <small>{new Date().toLocaleDateString()}</small>
      </div>
      <p className="small muted">{matches.map((m) => `${m.played_on ?? ''} ${m.label}${m.opponent ? ` vs ${m.opponent}` : ''}`.trim()).join(' · ')}</p>

      <section className="findings scout-plan">
        <h2>How to play them</h2>
        {r.plan.length ? <ol>{r.plan.map((t, i) => <li key={i}>{t}</li>)}</ol>
          : <p className="small muted">Not enough tagged touches for a clear pattern yet. Every line needs at least {MIN.receiver} passes, attacks or serves behind it.</p>}
      </section>

      <div className="print-kpis">
        <div><span>Attack</span><b>{r.team.attackEff == null ? '–' : eff(r.team.attackEff)}</b><small>{r.team.kills} kills in {r.team.attempts} ({pct(r.team.killPct)})</small></div>
        <div><span>Pass avg</span><b>{r.team.recAvg?.toFixed(2) ?? '–'}</b><small>{r.team.receptions} passes, {pct(r.team.recPerfectPct)} perfect</small></div>
        <div><span>Serve</span><b>{pct(r.team.serveInPct)}</b><small>in · {r.team.aces} aces, {r.team.serveErrors} errors</small></div>
      </div>

      {recv.length > 0 && (
        <section className="print-table">
          <h2>Reception (weakest first)</h2>
          <table><thead><tr><th>Player</th><th>Passes</th><th>Avg</th><th>Bad</th><th>Errors</th></tr></thead>
            <tbody>{recv.map((x) => <tr key={x.player.id}><td>{who(x.player)}</td><td>{x.n}</td><td>{x.avg.toFixed(2)}</td><td>{pct(x.bad / x.n)}</td><td>{x.errors}</td></tr>)}</tbody>
          </table>
          {r.receiveZones.some((z) => z.n) && (
            <p className="print-note">Pass average by zone: {r.receiveZones.filter((z) => z.n).map((z) => `${z.zone}: ${z.value!.toFixed(2)} (${z.n})`).join(' · ')}</p>
          )}
        </section>
      )}

      {r.serve.passes > 0 && (
        <section className="print-table">
          <h2>Serve targets</h2>
          <ServeTargets plan={r.serve} />
        </section>
      )}

      {hitters.length > 0 && (
        <section className="print-table">
          <h2>Attackers</h2>
          <table><thead><tr><th>Player</th><th>Share</th><th>Att</th><th>Kill %</th><th>Eff</th><th>Tips</th><th>From</th><th>Line / cross / cut</th></tr></thead>
            <tbody>{hitters.map((x) => {
              const d = x.dirs.line + x.dirs.cross + x.dirs.cut;
              return (
                <tr key={x.player.id}><td>{who(x.player)}</td><td>{pct(x.share)}</td><td>{x.attempts}</td><td>{pct(x.killPct)}</td><td>{eff(x.eff)}</td><td>{x.tips ? pct(x.tips / x.attempts) : '–'}</td>
                  <td>{x.origins.slice(0, 2).map((o) => `${ORIGIN[o.key]} ${Math.round((o.n / x.attempts) * 100)}%`).join(', ') || '–'}</td>
                  <td>{d ? `${pct(x.dirs.line / d)} / ${pct(x.dirs.cross / d)} / ${pct(x.dirs.cut / d)}` : '–'}</td></tr>
              );
            })}</tbody>
          </table>
        </section>
      )}

      {(r.setter.good.n > 0 || r.setter.bad.n > 0) && (
        <section className="print-table">
          <h2>Where the setter goes</h2>
          <table><thead><tr><th>After</th><th>Sets</th><th>Zone 4</th><th>Middle</th><th>Zone 2</th><th>Back row</th></tr></thead>
            <tbody>
              <DistRow label="a good pass or dig" d={r.setter.good} />
              <DistRow label="a bad pass or dig" d={r.setter.bad} />
            </tbody>
          </table>
          <p className="print-note">From the attacks that followed (where they were hit from), when the pass or dig before them was tagged.</p>
        </section>
      )}

      {servers.length > 0 && (
        <section className="print-table">
          <h2>Servers</h2>
          <table><thead><tr><th>Player</th><th>Serves</th><th>Aces</th><th>Errors</th><th>Mostly to</th></tr></thead>
            <tbody>{servers.map((x) => {
              const landed = x.targets.reduce((a, b) => a + b.n, 0);
              return <tr key={x.player.id}><td>{who(x.player)}</td><td>{x.n}</td><td>{x.aces}</td><td>{x.errors}</td>
                <td>{x.targets.slice(0, 2).map((z) => `zone ${z.zone} ${Math.round((z.n / landed) * 100)}%`).join(', ') || '–'}</td></tr>;
            })}</tbody>
          </table>
        </section>
      )}

      {r.rotations && (
        <section className="print-table">
          <h2>Rotations</h2>
          <table><thead><tr><th>Setter in</th><th>Receiving</th><th>Side-out</th><th>Serving</th><th>Break</th></tr></thead>
            <tbody>{r.rotations.map((x) => <tr key={x.rotation}><td>{x.rotation}</td><td>{x.receiving}</td><td>{pct(sideOutPct(x))}</td><td>{x.serving}</td><td>{pct(breakPct(x))}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <section className="print-table">
        <h2>Points</h2>
        <table><thead><tr><th>How they win points</th><th></th><th>How they lose points</th><th></th></tr></thead>
          <tbody>{Array.from({ length: Math.max(r.points.won.length, r.points.lost.length) }, (_, i) => (
            <tr key={i}><td>{r.points.won[i]?.label ?? ''}</td><td>{r.points.won[i]?.value ?? ''}</td><td style={{ textAlign: 'left' }}>{r.points.lost[i]?.label ?? ''}</td><td>{r.points.lost[i]?.value ?? ''}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}

function DistRow({ label, d }: { label: string; d: Distribution }) {
  const f = (n: number) => (d.n ? pct(n / d.n) : '–');
  return <tr><td>{label}</td><td>{d.n}</td><td>{f(d.to['4'])}</td><td>{f(d.to['3'])}</td><td>{f(d.to['2'])}</td><td>{f(d.to.back)}</td></tr>;
}
