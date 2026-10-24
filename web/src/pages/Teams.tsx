import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Team } from '../lib/api';

export function Teams() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState('');

  const load = () => api.teams().then(setTeams);
  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <header className="page-head"><h1>Teams</h1></header>
      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await api.createTeam(name.trim());
        setName('');
        load();
      }}>
        <input className="input" placeholder="New team name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary">Add</button>
      </form>
      <ul className="list">
        {teams.map((t) => (
          <li key={t.id}>
            <Link to={`/teams/${t.id}`} className="list-item">
              <b>{t.name}</b>
              <span className="muted">{t.player_count} players ›</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
