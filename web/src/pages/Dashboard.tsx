import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Match, type Team } from '../lib/api';

export function Dashboard() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    api.matches().then(setMatches);
    api.teams().then(setTeams);
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Dashboard</h1>
        <button className="btn-ghost small" onClick={() => api.logout().then(() => location.reload())}>Log out</button>
      </header>

      <div className="quick">
        <Link to="/new?mode=video" className="quick-card">
          <span className="quick-icon">🎬</span><b>Tag from video</b><small>YouTube, phone video or upload</small>
        </Link>
        <Link to="/new?mode=live" className="quick-card">
          <span className="quick-icon">⏱</span><b>Live match</b><small>Score and tag courtside</small>
        </Link>
      </div>

      {teams.length === 0 && (
        <div className="card notice">
          Start by <Link to="/teams">creating your team</Link> and adding the roster with jersey numbers and roles.
          Jersey numbers are what the auto-detection uses to match players.
        </div>
      )}

      <h2 className="section-title">Recent matches</h2>
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
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
