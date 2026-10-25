import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ROLES, type RoleCode } from '../lib/actions';
import { api, type Player, type Team } from '../lib/api';
import { parseRoster } from '../lib/roster';

export function TeamPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const [team, setTeam] = useState<(Team & { players: Player[] }) | null>(null);
  const [draft, setDraft] = useState({ name: '', number: '', role: 'OH' as RoleCode });
  const [paste, setPaste] = useState<string | null>(null);

  const load = () => api.team(id).then(setTeam);
  useEffect(() => { load(); }, [id]);

  if (!team) return <p className="muted">Loading…</p>;

  const numbers = team.players.filter((p) => p.active).map((p) => p.number);
  const duplicate = draft.number !== '' && numbers.includes(Number(draft.number));

  return (
    <div className="page">
      <header className="page-head">
        <h1>{team.name}</h1>
        <button className="btn-ghost small" onClick={async () => {
          if (!confirm(`Delete team ${team.name}? Matches stay but lose their roster link.`)) return;
          await api.deleteTeam(team.id);
          nav('/teams');
        }}>Delete</button>
      </header>

      <h2 className="section-title">Roster</h2>
      <form className="roster-form" onSubmit={async (e) => {
        e.preventDefault();
        if (!draft.name.trim()) return;
        await api.addPlayer(team.id, { name: draft.name.trim(), number: draft.number === '' ? null : Number(draft.number), role: draft.role });
        setDraft({ name: '', number: '', role: draft.role });
        load();
      }}>
        <input className="input num" inputMode="numeric" placeholder="#" value={draft.number}
          onChange={(e) => setDraft({ ...draft, number: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
        <input className="input" placeholder="Player name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <select className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as RoleCode })}>
          {ROLES.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
        </select>
        <button className="btn btn-primary">Add</button>
      </form>
      {duplicate && <p className="error small">Jersey #{draft.number} is already taken.</p>}
      {paste == null ? (
        <button className="btn-ghost small" onClick={() => setPaste('')}>Paste a whole roster…</button>
      ) : (() => {
        const lines = parseRoster(paste);
        return (
          <div className="card paste-roster">
            <span className="small muted">One player per line, e.g. <code>7 Bea OH</code> or <code>Anna Meier 12 libero</code>.</span>
            <textarea className="input" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'7 Bea OH\n3 Anna OH\n5 Fia S\n1 Gina L'} />
            {lines.length > 0 && (
              <ul className="small">
                {lines.map((l, i) => (
                  <li key={i}>#{l.number ?? '–'} {l.name} · {l.role}{l.number != null && numbers.includes(l.number) ? ' (number taken: skipped)' : ''}</li>
                ))}
              </ul>
            )}
            <div className="row">
              <button className="btn btn-primary" disabled={!lines.length} onClick={async () => {
                for (const l of lines) if (l.number == null || !numbers.includes(l.number)) await api.addPlayer(team.id, l);
                setPaste(null);
                load();
              }}>Add {lines.length} players</button>
              <button className="btn-ghost" onClick={() => setPaste(null)}>Cancel</button>
            </div>
          </div>
        );
      })()}

      <ul className="list">
        {team.players.map((p) => (
          <li key={p.id} className={`list-item ${p.active ? '' : 'inactive'}`}>
            <span className={`num-dot role-${p.role}`}>{p.number ?? '–'}</span>
            <span className="grow">{p.name}</span>
            <select className="input slim" value={p.role} onChange={async (e) => { await api.updatePlayer(p.id, { role: e.target.value as RoleCode }); load(); }}>
              {ROLES.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
            </select>
            {p.active ? (
              <button className="btn-ghost small" onClick={async () => { await api.deletePlayer(p.id); load(); }}>Remove</button>
            ) : (
              <button className="btn-ghost small" onClick={async () => { await api.updatePlayer(p.id, { active: 1 }); load(); }}>Restore</button>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">Roles: {ROLES.map((r) => `${r.code} = ${r.label}`).join(' · ')}</p>
    </div>
  );
}
