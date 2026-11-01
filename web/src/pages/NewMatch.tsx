import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { parseYouTubeId } from '../components/VideoPlayer';
import { api, isApp, type Team } from '../lib/api';
import { describeLink } from '../lib/native';
import { MatchSheetScan } from '../components/MatchSheetScan';
import { lineupsFromSheet, type MatchSheetFlow } from '../lib/sheetFlow';

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
  const [sheet, setSheet] = useState<{ flow: MatchSheetFlow; liberoNo: number | null } | null>(null);

  useEffect(() => {
    api.teams().then((t) => {
      setTeams(t);
      if (t.length === 1) setTeamId(t[0].id);
    });
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const link = yt.trim();
    const ytId = link ? parseYouTubeId(link) : null;
    if (link && !/^https?:\/\//i.test(link) && !ytId) return setError('Paste the full link, starting with https://');
    if (link && !ytId && !isApp() && !/\.(mp4|mov|m4v|webm)(\?|$)/i.test(link)) {
      return setError(`${describeLink(link)} links are downloaded by the Android app. Create the match in the app, or use a YouTube link here.`);
    }
    const m = await api.createMatch({
      team_id: teamId === '' ? null : teamId,
      label: label.trim() || `${opponent ? `vs ${opponent}` : 'Match'} ${date}`,
      opponent: opponent || null,
      played_on: date,
      mode,
      video_type: ytId ? 'youtube' : null,
      video_ref: ytId,
    });
    // The match flow from the scanned sheet, and the starting six per set as line-ups.
    if (sheet) {
      const players = teamId === '' ? [] : (await api.team(teamId)).players;
      const lineups = lineupsFromSheet(sheet.flow, players, sheet.liberoNo);
      await api.updateMatch(m.id, { sheet: sheet.flow, ...(Object.keys(lineups).length ? { lineups } : {}) }).catch(() => {});
    }
    // Non-YouTube links (WeTransfer, Drive, …) and, in the app, YouTube too are downloaded to the phone on the next screen.
    if (link && (isApp() || !ytId)) localStorage.setItem(`viq:pendingLink:${m.id}`, link);
    nav(`/m/${m.id}`);
  }

  return (
    <div className="page">
      <header className="page-head"><h1>New match</h1></header>
      <div className="segmented">
        <button className={mode === 'video' ? 'on' : ''} onClick={() => setMode('video')}>From video</button>
        <button className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}>Live</button>
      </div>
      <MatchSheetScan
        onPick={({ opponent: op, date: d, label: lb, flow, liberoNo }) => {
          setOpponent(op);
          setSheet(flow ? { flow, liberoNo } : null);
          if (d) setDate(d);
          if (lb) setLabel(lb);
        }}
        onTeamCreated={(id) => { api.teams().then(setTeams); setTeamId((cur) => (cur === '' ? id : cur)); }}
      />
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
            <label className="field-label">
              Video link (optional): {isApp() ? 'WeTransfer, YouTube, Google Drive, Dropbox, Vimeo…' : 'YouTube or a direct video link'}
            </label>
            <input className="input" type="url" inputMode="url" autoCapitalize="off" value={yt} onChange={(e) => setYt(e.target.value)}
              placeholder={isApp() ? 'https://we.tl/… or https://youtu.be/…' : 'https://youtu.be/…'} />
            <p className="muted small">You can also pick a video file on the next screen.</p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary wide">Start tagging</button>
      </form>
    </div>
  );
}
