import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { parseYouTubeId } from '../components/VideoPlayer';
import { api, type Team } from '../lib/api';

export function NewMatch() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [mode, setMode] = useState<'video' | 'live'>(params.get('mode') === 'live' ? 'live' : 'video');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [label, setLabel] = useState('');
  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [yt, setYt] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.teams().then((t) => {
      setTeams(t);
      if (t.length === 1) setTeamId(t[0].id);
    });
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const ytId = yt ? parseYouTubeId(yt) : null;
    if (yt && !ytId) return setError('That does not look like a YouTube link.');
    const m = await api.createMatch({
      team_id: teamId === '' ? null : teamId,
      label: label.trim() || `${opponent ? `vs ${opponent}` : 'Match'} ${date}`,
      opponent: opponent || null,
      played_on: date,
      mode,
      video_type: ytId ? 'youtube' : null,
      video_ref: ytId,
    });
    nav(`/m/${m.id}`);
  }

  return (
    <div className="page">
      <header className="page-head"><h1>New match</h1></header>
      <div className="segmented">
        <button className={mode === 'video' ? 'on' : ''} onClick={() => setMode('video')}>🎬 From video</button>
        <button className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}>⏱ Live</button>
      </div>
      <form className="form" onSubmit={create}>
        <label className="field-label">Team</label>
        <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Select team…</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="field-label">Opponent</label>
        <input className="input" value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="e.g. VC Nord" />
        <label className="field-label">Date</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="field-label">Label (optional)</label>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="League round 4" />
        {mode === 'video' && (
          <>
            <label className="field-label">YouTube link (optional, you can also pick a file on the next screen)</label>
            <input className="input" value={yt} onChange={(e) => setYt(e.target.value)} placeholder="https://youtu.be/…" />
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary wide">Start tagging</button>
      </form>
    </div>
  );
}
