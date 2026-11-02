import { useEffect, useMemo, useState } from 'react';
import { api, type Match, type Player, type Team, type VEvent } from '../lib/api';
import { scoutingReport } from '../lib/scouting';
import { teamRates, type Rates } from '../lib/simulate';
import { timeoutBrief } from '../lib/timeout';

const n = (k: number, one: string, many = `${one}s`) => (k ? `${k} ${k === 1 ? one : many}` : '');
const pct = (won: number, n: number) => (n ? `${Math.round((won / n) * 100)}%` : '–');
const who = (p: Player) => `#${p.number ?? '?'} ${p.name && !/^#?\d+$/.test(p.name.trim()) ? p.name.split(' ')[0] : ''}`.trim();

/**
 * The time-out card: the set so far in a few lines to read out in 30 seconds, our season rates
 * for comparison, and the opponent's game plan when they were scouted (a team with their name).
 */
export function TimeoutSheet({ match, players, events, set, onClose }: { match: Match; players: Player[]; events: VEvent[]; set: number; onClose: () => void }) {
  const [season, setSeason] = useState<Rates | null>(null);
  const [plan, setPlan] = useState<{ team: Team; lines: string[] } | null>(null);
  useEffect(() => {
    if (match.team_id) {
      api.teamReport(match.team_id).then((d) => {
        const others = d.matches.filter((m) => m.id !== match.id);
        setSeason(teamRates(d.events.filter((e) => e.match_id !== match.id), others, d.players));
      }).catch(() => {});
    }
    const opp = match.opponent?.trim().toLowerCase();
    if (opp) {
      api.teams().then(async (ts) => {
        const t = ts.find((x) => x.name.trim().toLowerCase() === opp);
        if (!t) return;
        const d = await api.teamReport(t.id);
        const lines = scoutingReport(d.players, d.events, d.matches).plan;
        if (lines.length) setPlan({ team: t, lines: lines.slice(0, 4) });
      }).catch(() => {});
    }
  }, [match.id, match.team_id, match.opponent]);
  const b = useMemo(() => timeoutBrief(events, set, players, season), [events, set, players, season]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet timeout-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Time-out">
        <div className="sheet-head">
          <b>Time-out · set {set} · {b.score.us} : {b.score.them}</b>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {b.points.length > 0 ? (
          <ol className="timeout-points">{b.points.map((p, i) => <li key={i}>{p}</li>)}</ol>
        ) : <p className="small muted">Nothing stands out yet{b.recent.n < 5 ? ' (too few rallies tagged in this set)' : ''}.</p>}

        <div className="timeout-grid">
          <div><span>Last {b.recent.n}</span><b>{b.recent.won} : {b.recent.n - b.recent.won}</b>
            <small>{[n(b.recent.kills, 'kill'), n(b.recent.aces, 'ace'), n(b.recent.blocks, 'block'), n(b.recent.oppErrors, 'error of theirs', 'errors of theirs')].filter(Boolean).join(', ') || 'no points'}
              {' · '}{n(b.recent.ourErrors, 'error of ours', 'errors of ours') || 'no errors of ours'}</small></div>
          <div><span>Side-out</span><b>{pct(b.sideout.won, b.sideout.n)}</b><small>{b.sideout.won}/{b.sideout.n}{season?.n.receiving ? ` · season ${Math.round(season.overall.sideout * 100)}%` : ''}</small></div>
          <div><span>Break</span><b>{pct(b.brk.won, b.brk.n)}</b><small>{b.brk.won}/{b.brk.n}{season?.n.serving ? ` · season ${Math.round(season.overall.brk * 100)}%` : ''}</small></div>
        </div>

        {(b.attackers.length > 0 || b.passers.length > 0) && (
          <div className="timeout-players small">
            {b.attackers.length > 0 && <p><b>Attack</b> {b.attackers.slice(0, 5).map((a) => `${who(a.player)} ${a.kills}/${a.errors}/${a.attempts}`).join(' · ')} <span className="muted">(kills/errors/attempts)</span></p>}
            {b.passers.length > 0 && <p><b>Pass</b> {b.passers.map((p) => `${who(p.player)} ${p.avg.toFixed(1)} (${p.n})`).join(' · ')}</p>}
          </div>
        )}

        {plan && (
          <div className="timeout-plan">
            <b className="small">Game plan against {plan.team.name}</b>
            <ul className="small">{plan.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
