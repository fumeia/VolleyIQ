import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ROLES, type RoleCode } from '../lib/actions';
import { api, type Player, type ScheduleGame, type Team } from '../lib/api';
import { GameSheet, ScheduleTable } from '../components/Schedule';
import { parseRoster } from '../lib/roster';
import { anonymousExport } from '../lib/anonymize';

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
          <h1 className="row">{team.name} <button className="btn-ghost small" onClick={() => setTeamName(team.name)} title="Rename the team">✎ Rename</button></h1>
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
        <div className="row">
          <button className="btn-ghost small" onClick={async () => {
            const data = await api.teamReport(team.id);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${team.name.replace(/[^\w]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}>Export data</button>
          <button className="btn-ghost small" title="For training the auto-detection: shirt numbers and roles only, no names, teams, opponents or dates" onClick={async () => {
            const data = anonymousExport(await api.teamReport(team.id));
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `volleyiq_training_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}>Export for training (numbers only)</button>
          <button className="btn-ghost small" onClick={async () => {
            if (!confirm(`Delete team ${team.name}? Matches stay but lose their roster link.`)) return;
            await api.deleteTeam(team.id);
            nav('/teams');
          }}>Delete</button>
        </div>
      </header>

      <label className="toggle tips-toggle">
        <input type="checkbox" checked={!!team.show_tips} onChange={async (e) => {
          await api.updateTeam(team.id, { show_tips: e.target.checked ? 1 : 0 });
          load();
        }} />
        <span>Show "What to practise" on the player pages <small className="muted">(also the default on the public link, where viewers can switch them)</small></span>
      </label>
      {!!team.show_tips && <p className="tips-warning small">⚠ These tips are pre-written suggestions, drafted with AI when VolleyIQ was built, and picked automatically from the tagged touches. Nothing is generated live, and they are not a coach's assessment.</p>}

      <SwissVolleyBox team={team} onChanged={load} />

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

/** The team's schedule and results from Swiss Volley, linked once with the team's page there. */
function SwissVolleyBox({ team, onChanged }: { team: Team; onChanged: () => void }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sched, setSched] = useState<{ games: ScheduleGame[]; videoSearch: boolean } | null>(null);
  const [game, setGame] = useState<ScheduleGame | null>(null);
  const load = () => api.schedule(team.id).then((s) => setSched({ games: s.games, videoSearch: s.videoSearch })).catch(() => {});
  useEffect(() => { if (team.sv_link) load(); else setSched(null); }, [team.id, team.sv_link, team.sv_synced_at]);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await f(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  const when = (s: string) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <section className="card sv-box">
      <div className="row between wrap">
        <b>Schedule from Swiss Volley</b>
        {team.sv_link && (
          <span className="row">
            <button className="btn-ghost small" disabled={busy} onClick={() => run(() => api.syncSchedule(team.id))}>{busy ? 'Reading…' : 'Update now'}</button>
            <button className="btn-ghost small" disabled={busy} onClick={() => { if (confirm('Unlink the team from Swiss Volley? Its schedule disappears here (tagged matches stay).')) run(() => api.unlinkSwissVolley(team.id)); }}>Unlink</button>
          </span>
        )}
      </div>
      {team.sv_link ? (
        <>
          <span className="small muted">
            {team.sv_caption ?? 'Linked'}{team.sv_synced_at ? ` · read ${when(team.sv_synced_at)}` : ''} · updates by itself twice a day
          </span>
          {team.sv_error && <span className="small error">Last update failed: {team.sv_error}</span>}
          {sched && <ScheduleTable games={sched.games} onPick={setGame} />}
          {game && <GameSheet game={game} videoSearch={!!sched?.videoSearch} onClose={() => setGame(null)} onChanged={load} />}
        </>
      ) : (
        <>
          <span className="small muted">
            Open your team in the <a href="https://www.volleyball.ch/de/game-center" target="_blank" rel="noreferrer">Swiss Volley game center</a> (pick the league,
            then click your team), copy the link from the address bar and paste it here. The games, results and halls then show here and on Home.
          </span>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (link.trim()) run(() => api.linkSwissVolley(team.id, link.trim())); }}>
            <input className="input grow" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.volleyball.ch/de/game-center/club/…/team/…" />
            <button className="btn btn-primary" disabled={busy || !link.trim()}>{busy ? 'Reading…' : 'Link'}</button>
          </form>
        </>
      )}
      {error && <span className="small error">{error}</span>}
    </section>
  );
}
