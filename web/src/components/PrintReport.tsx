import { createPortal } from 'react-dom';
import type { Match, Player, VEvent } from '../lib/api';
import { playerStats, statLine } from '../lib/stats';
import { AnalysisCharts } from './AnalysisCharts';

const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const dec = (v: number | null, d = 2) => (v == null ? '–' : v.toFixed(d).replace(/^(-?)0\./, '$1.'));

/**
 * A print-ready report on white paper (A4 width): KPIs, key findings, every chart
 * and the player table. Shown as a full-screen preview; "Save as PDF" uses the
 * browser's print dialog, where the rest of the app is hidden.
 */
export function PrintReport({ title, subtitle, players, events, matches, onClose }: {
  title: string; subtitle: string; players: Player[]; events: VEvent[]; matches: Match[]; onClose: () => void;
}) {
  const confirmed = events.filter((e) => e.status === 'confirmed');
  const team = statLine(confirmed.filter((e) => e.player_id != null));
  const rows = playerStats(players, confirmed).filter((r) => r.count > 0).sort((a, b) => b.stats.points - a.stats.points);
  const kpis: [string, string, string][] = [
    ['Attack eff.', dec(team.attackEff, 3), `${team.kills} K · ${team.attackErrors} E · ${team.attempts} TA`],
    ['Kill %', pct(team.killPct), `${team.blocked} blocked`],
    ['Serve in', pct(team.serveInPct), `${team.aces} aces · ${team.serveErrors} errors`],
    ['Pass avg', dec(team.recAvg), `${team.receptions} passes · ${pct(team.recPerfectPct)} perfect`],
    ['Blocks', String(team.blockPoints), `${team.blockTouches} touches`],
    ['Errors', String(team.errors), `+/− ${team.plusMinus}`],
  ];
  return createPortal(
    <div className="print-root">
      <div className="print-bar no-print">
        <button className="btn btn-primary" onClick={() => window.print()}>Save as PDF / print</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <article className="print-page">
        <header className="print-head">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <small>VolleyIQ · {new Date().toISOString().slice(0, 10)}</small>
        </header>
        <section className="print-kpis">
          {kpis.map(([k, v, s]) => <div key={k}><span>{k}</span><b>{v}</b><small>{s}</small></div>)}
        </section>
        <AnalysisCharts players={players} events={events} matches={matches} />
        <section className="print-table">
          <h2>Players</h2>
          <table>
            <thead>
              <tr><th>Player</th><th>Pts</th><th>K</th><th>E</th><th>TA</th><th>Eff</th><th>Ace</th><th>SE</th><th>Pass</th><th>n</th><th>Dig</th><th>Blk</th><th>+/−</th></tr>
            </thead>
            <tbody>
              {rows.map(({ player: p, stats: s }) => (
                <tr key={p.id}>
                  <td>#{p.number ?? '–'} {p.name}{p.role ? <small> {p.role}</small> : null}</td>
                  <td>{s.points}</td><td>{s.kills}</td><td>{s.attackErrors}</td><td>{s.attempts}</td><td>{dec(s.attackEff, 3)}</td>
                  <td>{s.aces}</td><td>{s.serveErrors}</td><td>{dec(s.recAvg)}</td><td>{s.receptions}</td><td>{s.digs}</td>
                  <td>{s.blockPoints}</td><td>{s.plusMinus}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="print-note">K kills · E attack errors incl. blocked · TA attempts · Eff (K−E)/TA · SE serve errors · Pass average grade 0–3 · Blk block points</p>
        </section>
      </article>
    </div>,
    document.body,
  );
}
