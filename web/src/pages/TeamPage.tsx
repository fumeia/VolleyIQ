import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ROLES, type RoleCode } from '../lib/actions';
import { api, type Player, type Team } from '../lib/api';
import { parseRoster } from '../lib/roster';
import { anonymousExport } from '../lib/anonymize';
import { Download, Pencil, Trash2 } from 'lucide-react';

export function TeamPage() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const [team, setTeam] = useState<(Team & { players: Player[] }) | null>(null);
  const [draft, setDraft] = useState({ name: '', number: '', role: 'OH' as RoleCode });
  const [paste, setPaste] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string; number: string } | null>(null);

  const load = () => api.team(id).then(setTeam);
  useEffect(() => { load(); }, [id]);

  if (!team) return <p className="muted">Loading…</p>;

  const numbers = team.players.filter((p) => p.active).map((p) => p.number);
  const duplicate = draft.number !== '' && numbers.includes(Number(draft.number));

  return (
    <div className="page">
      <header className="page-head">
        {teamName == null ? (
          <h1>{team.name}</h1>
        ) : (
          <form className="row" onSubmit={async (e) => {
            e.preventDefault();
            if (teamName.trim()) await api.updateTeam(team.id, { name: teamName.trim() });
            setTeamName(null);
            load();
          }}>
            <input className="input" autoFocus value={teamName} onChange={(e) => setTeamName(e.target.value)} aria-label="Team name" />
            <button className="btn btn-primary">Save</button>
            <button type="button" className="btn-ghost" onClick={() => setTeamName(null)}>Cancel</button>
          </form>
        )}
        <div className="page-actions">
          <button className="btn small" onClick={() => setTeamName(team.name)}><Pencil /> Rename</button>
          <button className="btn small" onClick={async () => {
            const data = await api.teamReport(team.id);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${team.name.replace(/[^\w]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}><Download /> Export data</button>
          <button className="btn small" title="For training the auto-detection: shirt numbers and roles only, no names, teams, opponents or dates" onClick={async () => {
            const data = anonymousExport(await api.teamReport(team.id));
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `volleyiq_training_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}><Download /> Training export</button>
          <button className="btn small btn-quiet-danger" onClick={async () => {
            if (!confirm(`Delete team ${team.name}? Matches stay but lose their roster link.`)) return;
            await api.deleteTeam(team.id);
            nav('/teams');
          }}><Trash2 /> Delete</button>
        </div>
      </header>

      <label className="toggle tips-toggle card">
        <input type="checkbox" checked={!!team.show_tips} onChange={async (e) => {
          await api.updateTeam(team.id, { show_tips: e.target.checked ? 1 : 0 });
          load();
        }} />
        <span className="toggle-text"><span>Show "What to practise" on player pages</span><small className="muted">Also the default on the public link, where viewers can switch them</small></span>
      </label>
      {!!team.show_tips && <p className="tips-warning small">⚠ These tips are pre-written suggestions, drafted with AI when VolleyIQ was built, and picked automatically from the tagged touches. Nothing is generated live, and they are not a coach's assessment.</p>}

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
            {editing?.id === p.id ? (
              <form className="row grow" onSubmit={async (e) => {
                e.preventDefault();
                const n = editing.number === '' ? null : Number(editing.number);
                if (n != null && team.players.some((o) => o.id !== p.id && o.active && o.number === n)) { alert(`Jersey #${n} is already taken.`); return; }
                await api.updatePlayer(p.id, { name: editing.name.trim() || p.name, number: n });
                setEditing(null);
                load();
              }}>
                <input className="input num" inputMode="numeric" value={editing.number} aria-label="Jersey number"
                  onChange={(e) => setEditing({ ...editing, number: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                <input className="input grow" autoFocus value={editing.name} aria-label="Player name" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <button className="btn btn-primary small">Save</button>
                <button type="button" className="btn-ghost small" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span className={`num-dot role-${p.role}`}>{p.number ?? '–'}</span>
                <button className="grow link-like" title="Edit name and number" onClick={() => setEditing({ id: p.id, name: p.name, number: p.number == null ? '' : String(p.number) })}>{p.name} <small className="muted">✎</small></button>
              </>
            )}
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
