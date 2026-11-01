import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Link } from 'react-router-dom';
import { api, type Match, type ScheduleGame, type Team } from '../lib/api';
import { GameSheet, ScheduleTable } from '../components/Schedule';

export function Dashboard() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sched, setSched] = useState<{ games: ScheduleGame[]; linked: number; videoSearch: boolean } | null>(null);
  const [game, setGame] = useState<ScheduleGame | null>(null);
  const loadSchedule = () => api.schedule().then((s) => setSched({ games: s.games, linked: s.teams.length, videoSearch: s.videoSearch })).catch(() => {});

  useEffect(() => {
    api.matches().then(setMatches);
    api.teams().then(setTeams);
    loadSchedule();
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Dashboard</h1>
      </header>

      {(() => {
        // Most recent match with suggestions waiting: one tap back into the review.
        const open = matches?.find((m) => (m.suggested_count ?? 0) > 0);
        return open ? (
          <Link to={`/m/${open.id}`} className="continue-card">
            <span className="quick-icon">▶</span>
            <span><b>Continue reviewing: {open.label}</b><small className="muted">{open.suggested_count} suggestions waiting</small></span>
            <span className="go">›</span>
          </Link>
        ) : null;
      })()}

      <div className="quick">
        <Link to="/new?mode=video" className="quick-card">
          <span className="quick-icon"><Icon name="tag" size={26} /></span><b>Tag from video</b><small>YouTube, phone video or upload</small>
        </Link>
        <Link to="/new?mode=live" className="quick-card">
          <span className="quick-icon"><Icon name="live" size={26} /></span><b>Live match</b><small>Score and tag courtside</small>
        </Link>
      </div>

      {teams.length === 0 && (
        <div className="card notice">
          Start by <Link to="/teams">creating your team</Link> and adding the roster with jersey numbers and roles.
          Jersey numbers are what the auto-detection uses to match players.
        </div>
      )}

      <h2 className="section-title">Games{(() => { const n = sched?.games.reduce((a, g) => a + (g.suggestions?.length ?? 0), 0) ?? 0; return n ? <span className="badge badge-suggest">{n} video{n === 1 ? '' : 's'} sent by visitors</span> : null; })()}</h2>
      {sched && sched.linked > 0 ? (
        <ScheduleTable games={sched.games} showTeam={sched.linked > 1} limit={5} onPick={setGame} />
      ) : teams.length > 0 && sched ? (
        <p className="muted small">Link your team with Swiss Volley on its <Link to={`/teams/${teams[0].id}`}>team page</Link> to see the schedule and results here.</p>
      ) : null}
      {game && <GameSheet game={game} videoSearch={!!sched?.videoSearch} onClose={() => setGame(null)} onChanged={loadSchedule} />}

      <h2 className="section-title">Tagged matches</h2>
      {matches === null ? <p className="muted">Loading…</p> : matches.length === 0 ? (
        <p className="muted">No matches yet.</p>
      ) : (
        <ul className="list">
          {matches.map((m) => (
            <li key={m.id}>
              <Link to={`/m/${m.id}`} className="list-item">
                <div>
                  <b>{m.label}</b>
                  <div className="muted small">
                    {m.team_name ?? 'No team'} · {m.played_on ?? m.created_at?.slice(0, 10)} · {m.mode === 'live' ? 'Live' : 'Video'}
                  </div>
                </div>
                <div className="list-meta">
                  <span>{(m.event_count ?? 0) - (m.suggested_count ?? 0)} saved</span>
                  {!!m.suggested_count && <span className="badge">{m.suggested_count} to review</span>}
                  {!!m.open_edits && <span className="badge">✎ {m.open_edits} correction{m.open_edits === 1 ? '' : 's'}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {matches && <Effort matches={matches} />}
    </div>
  );
}

const hm = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}`;

/**
 * Analysis effort per match: active time spent, touches saved, and how many of the
 * auto-detected touches were right as they were (the rest were corrected or removed).
 */
function Effort({ matches }: { matches: Match[] }) {
  const rows = matches.filter((m) => (m.work_sec ?? 0) >= 60 || (m.auto_confirmed_count ?? 0) + (m.removed_count ?? 0) > 0);
  if (!rows.length) return null;
  const worked = rows.filter((m) => (m.work_sec ?? 0) >= 60);
  const avg = worked.length ? worked.reduce((a, m) => a + (m.work_sec ?? 0), 0) / worked.length : null;
  return (
    <>
      <h2 className="section-title">Analysis effort</h2>
      <p className="muted small">
        Active time on each match (counted while you tap or the video plays){avg != null && <> · average <b>{hm(avg)} h</b> per match</>}.
        Auto right = detected touches saved without changing player or action.
      </p>
      <div className="table-wrap">
        <table className="stat-table effort-table">
          <thead><tr><th>Match</th><th>Time</th><th>Saved</th><th>s / touch</th><th>Auto right</th><th>Fixed</th><th>Removed</th></tr></thead>
          <tbody>
            {rows.map((m) => {
              const sec = m.work_sec ?? 0, saved = m.confirmed_count ?? 0;
              const auto = m.auto_confirmed_count ?? 0, fixed = m.edited_count ?? 0, removed = m.removed_count ?? 0;
              const detected = auto + removed;
              return (
                <tr key={m.id}>
                  <td><Link to={`/m/${m.id}`}>{m.label}</Link></td>
                  <td>{sec >= 60 ? hm(sec) : '–'}</td>
                  <td>{saved}</td>
                  <td>{sec >= 60 && saved ? (sec / saved).toFixed(1) : '–'}</td>
                  <td>{detected ? `${Math.round((Math.max(0, auto - fixed) / detected) * 100)}%` : '–'}</td>
                  <td>{fixed}</td>
                  <td>{removed}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
