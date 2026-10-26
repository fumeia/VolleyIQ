import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Match, Player, VEvent } from '../lib/api';
import { playerStats } from '../lib/stats';
import { AttackSection } from './analysis/AttackSection';
import { DefenseSection } from './analysis/DefenseSection';
import { ErrorsSection } from './analysis/ErrorsSection';
import { OverviewSection } from './analysis/OverviewSection';
import { PlayersSection } from './analysis/PlayersSection';
import { printPage } from '../lib/native';
import { RotationsSection } from './analysis/RotationsSection';
import { ServePassSection } from './analysis/ServePassSection';
import { SettingSection } from './analysis/SettingSection';

const PARTS = [
  ['overview', 'Overview'], ['rotations', 'Rotations'], ['attack', 'Attack'], ['servepass', 'Serve & pass'], ['setting', 'Setting'],
  ['defense', 'Defence'], ['errors', 'Errors'], ['players', 'Player scorecards'], ['table', 'Player table'],
] as const;
type Part = (typeof PARTS)[number][0];

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
  const [parts, setParts] = useState<Set<Part>>(() => new Set(PARTS.map(([k]) => k)));
  const rows = playerStats(players, confirmed).filter((r) => r.count > 0).sort((a, b) => b.stats.points - a.stats.points);
  const on = (k: Part) => parts.has(k);
  const toggle = (k: Part) => setParts((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return createPortal(
    <div className="print-root">
      <div className="print-bar no-print">
        <button className="btn btn-primary" onClick={() => printPage(title)}>Save as PDF / print</button>
        <button className="btn" onClick={onClose}>Close</button>
        <div className="print-parts">
          {PARTS.map(([k, label]) => (
            <label key={k} className="toggle small"><input type="checkbox" checked={on(k)} onChange={() => toggle(k)} /> {label}</label>
          ))}
        </div>
      </div>
      <article className="print-page">
        <header className="print-head">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <small>VolleyIQ · {new Date().toISOString().slice(0, 10)}</small>
        </header>
        {on('overview') && <PrintPart title="Overview"><OverviewSection players={players} events={confirmed} matches={matches} /></PrintPart>}
        {on('rotations') && <PrintPart title="Rotations"><RotationsSection players={players} events={confirmed} matches={matches} /></PrintPart>}
        {on('attack') && <PrintPart title="Attack"><AttackSection players={players} events={confirmed} /></PrintPart>}
        {on('servepass') && <PrintPart title="Serve & pass"><ServePassSection players={players} events={confirmed} /></PrintPart>}
        {on('setting') && <PrintPart title="Setting"><SettingSection players={players} events={confirmed} /></PrintPart>}
        {on('defense') && <PrintPart title="Defence"><DefenseSection players={players} events={confirmed} /></PrintPart>}
        {on('errors') && <PrintPart title="Errors"><ErrorsSection players={players} events={confirmed} /></PrintPart>}
        {on('players') && <PrintPart title="Players"><PlayersSection players={players} events={confirmed} /></PrintPart>}
        {on('table') && <section className="print-table">
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
        </section>}
      </article>
    </div>,
    document.body,
  );
}

function PrintPart({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="print-part"><h2>{title}</h2>{children}</section>;
}
