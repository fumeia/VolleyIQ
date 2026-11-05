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
  // Practice match: both sides are our players (picked per set on the match page).
  const [practice, setPractice] = useState(params.get('practice') === '1');
  const [sideNames, setSideNames] = useState({ a: 'Near', b: 'Far' });
  // Opened from a game of the schedule (or a scouting video): filled in already.
  const [teamId, setTeamId] = useState<number | ''>(params.get('team') ? Number(params.get('team')) : '');
  const [label, setLabel] = useState(params.get('label') ?? '');
  const [opponent, setOpponent] = useState(params.get('opponent') ?? '');
  const [date, setDate] = useState(params.get('date') ?? new Date().toISOString().slice(0, 10));
  const [yt, setYt] = useState(params.get('video') ?? '');
  // In the app a YouTube video streams by default; downloading is only needed for the automatic tools.
  const [download, setDownload] = useState(false);
  const scheduleId = params.get('schedule') ? Number(params.get('schedule')) : null;
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<{ flow: MatchSheetFlow; liberoNo: number | null } | null>(null);

  useEffect(() => {
    api.teams().then((t) => {
      setTeams(t);
      if (t.length === 1) setTeamId((cur) => (cur === '' ? t[0].id : cur));
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
      label: label.trim() || (practice ? `Practice ${sideNames.a} - ${sideNames.b} ${date}` : `${opponent ? `vs ${opponent}` : 'Match'} ${date}`),
      opponent: practice ? null : opponent || null,
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
    if (practice) await api.updateMatch(m.id, { practice: { names: { a: sideNames.a.trim() || 'Near', b: sideNames.b.trim() || 'Far' }, sets: {} } });
    if (scheduleId) await api.scheduleMatch(scheduleId, m.id).catch(() => {});
    // Non-YouTube links (WeTransfer, Drive, …) are downloaded to the phone on the next screen; YouTube only when asked.
    if (link && (!ytId || (isApp() && download))) localStorage.setItem(`viq:pendingLink:${m.id}`, link);
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
        <label className="toggle">
          <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} /> Practice match: both sides are our players (sides picked per set)
        </label>
        {practice ? (
          <div className="row wrap">
            <label className="small">Near side <input className="input slim" value={sideNames.a} maxLength={30} onChange={(e) => setSideNames({ ...sideNames, a: e.target.value })} aria-label="Name of the first side" /></label>
            <label className="small">Far side <input className="input slim" value={sideNames.b} maxLength={30} onChange={(e) => setSideNames({ ...sideNames, b: e.target.value })} aria-label="Name of the second side" /></label>
          </div>
        ) : (
          <>
            <label className="field-label">Opponent</label>
            <input className="input" value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="e.g. VC Nord" />
          </>
        )}
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
            {isApp() && parseYouTubeId(yt.trim()) && (
              <label className="toggle small">
                <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />
                <span>Also download it to this phone <small className="muted">(needed for auto-detection, the AI check and reading shirt numbers; tagging by hand works with the YouTube video, and it can be downloaded later in the Auto tab)</small></span>
              </label>
            )}
            <p className="muted small">You can also pick a video file on the next screen.</p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary wide">Start tagging</button>
      </form>
    </div>
  );
}
