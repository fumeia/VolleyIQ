import { useEffect, useMemo, useState } from 'react';
import { StatsView } from '../components/StatsView';
import { PrintReport } from '../components/PrintReport';
import { api, publicBase, type Match, type Player, type Team, type VEvent } from '../lib/api';
import { MatchReportView, SeasonReportView } from '../report/ReportViews';
import { PlayerLearning } from '../components/analysis/PlayerLearning';
import { exportEventsCsv, exportPlayersCsv } from '../lib/csv';
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
  const [printing, setPrinting] = useState(false);
  const [view, setView] = useState<'report' | 'stats' | 'players' | 'board'>('stats');
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [showTips, setShowTips] = useState(false);

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
    setToken(undefined);
    api.teamReport(teamId).then(setData);
    api.team(teamId).then((t) => { setToken(t.share_token ?? null); setShowTips(!!t.show_tips); }).catch(() => setToken(null));
  }, [teamId]);

  const events = useMemo(
    () => (data ? (matchId === 'all' ? data.events : data.events.filter((e) => e.match_id === matchId)) : []),
    [data, matchId],
  );
  const rows = useMemo(() => (data ? playerStats(data.players, events).filter((r) => r.count) : []), [data, events]);

  return (
    <div className="page">
      <header className="page-head"><h1>Stats</h1>{teamId != null && <PublicLink teamId={teamId} token={token} setToken={setToken} />}</header>
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
        <button className={view === 'stats' ? 'on' : ''} onClick={() => setView('stats')}>Charts & stats</button>
        <button className={view === 'players' ? 'on' : ''} onClick={() => setView('players')}>Players</button>
        <button className={view === 'report' ? 'on' : ''} onClick={() => setView('report')}>Report images</button>
        <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Leaderboard</button>
      </div>
      {!teams.length && <p className="muted">Create a team first.</p>}
      {data && view === 'report' && (matchId === 'all' ? (
        <SeasonReportView title={teams.find((t) => t.id === teamId)?.name ?? 'Team'} matches={data.matches} players={data.players} events={events} />
      ) : (
        <MatchReportView match={{ ...data.matches.find((m) => m.id === matchId)!, team_name: teams.find((t) => t.id === teamId)?.name }}
          players={data.players} events={events} />
      ))}
      {data && view === 'stats' && events.some((e) => e.status === 'confirmed') && (() => {
        const one = matchId === 'all' ? null : data.matches.find((m) => m.id === matchId);
        return (
          <div className="row wrap">
            <button className="btn small" onClick={() => setPrinting(true)}>📄 PDF report</button>
            {one && <button className="btn small" onClick={() => exportEventsCsv(one, data.players, events)}>⬇ Events CSV</button>}
            {one && <button className="btn small" onClick={() => exportPlayersCsv(one, data.players, events)}>⬇ Player CSV</button>}
          </div>
        );
      })()}
      {data && view === 'players' && (() => {
        const active = data.players.filter((p) => events.some((e) => e.player_id === p.id)).sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
        const p = active.find((x) => x.id === playerId) ?? active[0];
        if (!p) return <p className="muted">No tagged touches yet.</p>;
        const url = token ? `${publicBase()}/s/t/${token}/p/${p.id}` : null;
        return (
          <>
            <div className="chips">
              {active.map((x) => <button key={x.id} className={`chip ${x.id === p.id ? 'on' : ''}`} onClick={() => setPlayerId(x.id)}>#{x.number ?? '–'} {x.name}</button>)}
            </div>
            <PlayerLearning player={p} players={data.players} events={events}
              matches={matchId === 'all' ? data.matches : data.matches.filter((m) => m.id === matchId)}
              showTips={showTips}
              tipsToggle={teamId != null && (
                <label className="toggle small">
                  <input type="checkbox" checked={showTips} onChange={async (e) => {
                    const on = e.target.checked;
                    setShowTips(on);
                    await api.updateTeam(teamId, { show_tips: on ? 1 : 0 });
                  }} /> Show the pre-written practice tips (also on the public player pages)
                </label>
              )}
              actions={url
                ? <button className="btn small" onClick={() => shareUrl(url, p.name)}>🔗 Share page</button>
                : <span className="muted small">Create the public link (top) to share this page.</span>} />
          </>
        );
      })()}
      {data && printing && (() => {
        const team = teams.find((t) => t.id === teamId)?.name ?? 'Team';
        const one = matchId === 'all' ? null : data.matches.find((m) => m.id === matchId);
        return (
          <PrintReport title={one ? `${team} – ${one.opponent ?? one.label}` : `${team} · season report`}
            subtitle={one ? `${one.label}${one.played_on ? ` · ${one.played_on}` : ''}` : `${data.matches.length} match${data.matches.length === 1 ? "" : "es"}`}
            players={data.players} events={events} matches={one ? [one] : data.matches} onClose={() => setPrinting(false)} />
        );
      })()}
      {data && view === 'stats' && (
        <StatsView players={data.players} events={events} matches={matchId === 'all' ? data.matches : data.matches.filter((m) => m.id === matchId)} />
      )}
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

async function shareUrl(url: string, title: string) {
  if (navigator.share) navigator.share({ title, url }).catch(() => {});
  else { await navigator.clipboard.writeText(url); alert('Link copied'); }
}

/** The public team site (season, matches, player pages): no login needed, revocable. */
function PublicLink({ teamId, token, setToken }: { teamId: number; token: string | null | undefined; setToken: (t: string | null) => void }) {
  if (token === undefined) return null;
  const url = token ? `${publicBase()}/s/t/${token}` : null;
  return url ? (
    <div className="row">
      <button className="btn" onClick={() => shareUrl(url, 'Team stats')}>🔗 Share public stats</button>
      <a className="btn-ghost small" href={url} target="_blank" rel="noreferrer">Open</a>
      <button className="btn-ghost small" onClick={async () => {
        if (confirm('Revoke the public link? Everyone with the old link loses access.')) setToken((await api.shareTeam(teamId, true)).share_token);
      }}>Revoke</button>
    </div>
  ) : (
    <button className="btn" onClick={async () => setToken((await api.shareTeam(teamId)).share_token)}>🔗 Create public stats link</button>
  );
}
