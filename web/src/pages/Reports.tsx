import { useEffect, useMemo, useState } from 'react';
import { StatsView } from '../components/StatsView';
import { api, type Match, type Player, type Team, type VEvent } from '../lib/api';
import { dec, pct, playerStats, type StatLine } from '../lib/stats';

const BOARDS: { label: string; v: (s: StatLine) => number | null; fmt: (n: number | null) => string; min?: (s: StatLine) => boolean }[] = [
  { label: 'Points', v: (s) => s.points, fmt: String },
  { label: 'Kills', v: (s) => s.kills, fmt: String },
  { label: 'Attack eff.', v: (s) => s.attackEff, fmt: (n) => dec(n, 3), min: (s) => s.attempts >= 10 },
  { label: 'Aces', v: (s) => s.aces, fmt: String },
  { label: 'Pass avg', v: (s) => s.recAvg, fmt: (n) => dec(n), min: (s) => s.receptions >= 10 },
  { label: 'Serve in %', v: (s) => s.serveInPct, fmt: pct, min: (s) => s.serves >= 10 },
  { label: 'Blocks', v: (s) => s.blockPoints, fmt: String },
  { label: 'Digs', v: (s) => s.digs, fmt: String },
];

export function Reports() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [data, setData] = useState<{ players: Player[]; matches: Match[]; events: VEvent[] } | null>(null);
  const [matchId, setMatchId] = useState<number | 'all'>('all');
  const [view, setView] = useState<'stats' | 'board'>('stats');

  useEffect(() => {
    api.teams().then((t) => {
      setTeams(t);
      if (t.length) setTeamId(t[0].id);
    });
  }, []);

  useEffect(() => {
    if (teamId == null) return;
    setData(null);
    setMatchId('all');
    api.teamReport(teamId).then(setData);
  }, [teamId]);

  const events = useMemo(
    () => (data ? (matchId === 'all' ? data.events : data.events.filter((e) => e.match_id === matchId)) : []),
    [data, matchId],
  );
  const rows = useMemo(() => (data ? playerStats(data.players, events).filter((r) => r.count) : []), [data, events]);

  return (
    <div className="page">
      <header className="page-head"><h1>Reports</h1></header>
      <div className="row wrap">
        <select className="input" value={teamId ?? ''} onChange={(e) => setTeamId(Number(e.target.value))}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {data && (
          <select className="input" value={matchId} onChange={(e) => setMatchId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">All matches ({data.matches.length})</option>
            {data.matches.map((m) => <option key={m.id} value={m.id}>{m.played_on} · {m.label}</option>)}
          </select>
        )}
      </div>
      <div className="segmented">
        <button className={view === 'stats' ? 'on' : ''} onClick={() => setView('stats')}>Stats & heatmaps</button>
        <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Leaderboard</button>
      </div>
      {!teams.length && <p className="muted">Create a team first.</p>}
      {data && view === 'stats' && <StatsView players={data.players} events={events} />}
      {data && view === 'board' && (
        <div className="boards">
          {BOARDS.map((b) => {
            const top = rows
              .filter((r) => (b.min ? b.min(r.stats) : true) && b.v(r.stats) != null && b.v(r.stats)! > 0)
              .sort((x, y) => b.v(y.stats)! - b.v(x.stats)!)
              .slice(0, 5);
            return (
              <div key={b.label} className="card board">
                <b>{b.label}</b>
                {top.length === 0 ? <p className="muted small">Not enough data</p> : (
                  <ol>
                    {top.map((r) => (
                      <li key={r.player.id}>
                        <span>#{r.player.number} {r.player.name}</span>
                        <b>{b.fmt(b.v(r.stats))}</b>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
