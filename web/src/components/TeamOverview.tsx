import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Match, type Player, type ScheduleGame, type VEvent } from '../lib/api';
import { buildRallies, phaseScoring } from '../lib/sequence';
import { playerStats, teamLine } from '../lib/stats';
import { Kpi } from './analysis/OverviewSection';
import { avg2, eff3, judge, pct } from './analysis/ui';
import { gameDay, gameTime, ScheduleTable } from './Schedule';
import { parseYouTubeId } from './VideoPlayer';

const won = (g: ScheduleGame) => {
  if (!g.result || !g.side) return null;
  const [h, a] = g.result.split(':').map(Number);
  return g.side === 'home' ? h > a : a > h;
};

/**
 * The public team page's front page: the next game, upcoming games and results (with their
 * videos), the season so far, the leaders and the tagged matches.
 */
export function TeamOverview({ token, base, players, events, matches }: { token: string; base: string; players: Player[]; events: VEvent[]; matches: Match[] }) {
  const [games, setGames] = useState<ScheduleGame[] | null>(null);
  const [game, setGame] = useState<ScheduleGame | null>(null);
  const load = () => api.sharedSchedule(token).then((r) => setGames(r.games)).catch(() => setGames([]));
  useEffect(() => { load(); }, [token]);

  const ph = useMemo(() => phaseScoring(buildRallies(events)), [events]);
  const team = useMemo(() => teamLine(events), [events]);
  const leaders = useMemo(() => {
    const rows = playerStats(players, events).filter((r) => r.count > 0);
    const top = (f: (s: (typeof rows)[number]['stats']) => number, label: string) => {
      const best = [...rows].sort((a, b) => f(b.stats) - f(a.stats))[0];
      return best && f(best.stats) > 0 ? { label, player: best.player, n: f(best.stats) } : null;
    };
    return [top((s) => s.points, 'Points'), top((s) => s.kills, 'Kills'), top((s) => s.aces, 'Aces'), top((s) => s.blockPoints, 'Blocks')].filter(Boolean) as { label: string; player: Player; n: number }[];
  }, [players, events]);

  const today = new Date().toISOString().slice(0, 10);
  const next = games?.find((g) => !g.result && !g.cancelled && g.starts_at.slice(0, 10) >= today) ?? null;
  const played = games?.filter((g) => g.result) ?? [];
  const wins = played.filter((g) => won(g)).length;
  const videos = games?.filter((g) => g.video?.state === 'confirmed').length ?? 0;
  const opp = (g: ScheduleGame) => (g.side === 'home' ? g.away : g.home);

  return (
    <div className="dash">
      <div className="dash-main">
        {next && (
          <button className="card next-game" onClick={() => setGame(next)} data-tour="next-game">
            <span className="kpi-label">Next game</span>
            <b className="next-vs">{next.side === 'away' ? `at ${next.home}` : `vs ${opp(next)}`}</b>
            <span>{gameDay(next.starts_at)}, {gameTime(next.starts_at)}{next.hall ? ` · ${next.hall}` : ''}</span>
            {next.league && <small className="muted">{next.league}</small>}
          </button>
        )}
        {games && games.length > 0 && (
          <section className="dash-games" data-tour="games">
            <h2 className="section-title">Games {videos > 0 && <small className="muted">· {videos} with video</small>}</h2>
            <ScheduleTable games={games} limit={6} onPick={setGame} />
          </section>
        )}
        {games && games.length === 0 && matches.length === 0 && <p className="muted">Nothing here yet.</p>}
      </div>

      <aside className="dash-side">
        {played.length > 0 && (
          <section className="card dash-card">
            <h2 className="section-title">Season</h2>
            <div className="record"><b className="tone-good">{wins}</b> won <span className="muted">·</span> <b className="tone-bad">{played.length - wins}</b> lost</div>
            <div className="form-strip" aria-label="Last results">
              {played.slice(-8).map((g) => <span key={g.id} className={won(g) ? 'w' : 'l'} title={`${opp(g)} ${g.result}`}>{won(g) ? 'W' : 'L'}</span>)}
            </div>
          </section>
        )}
        {events.length > 0 && (
          <section className="card dash-card" data-tour="season-numbers">
            <h2 className="section-title">From the tagged matches</h2>
            <div className="kpis kpis-2">
              <Kpi label="Side-out" value={pct(ph.sideoutPct)} sub={`${ph.sideout.won}/${ph.sideout.n}`} tone={ph.sideout.n >= 8 ? judge.sideout(ph.sideoutPct) : null} />
              <Kpi label="Break point" value={pct(ph.breakPct)} sub={`${ph.break.won}/${ph.break.n}`} tone={ph.break.n >= 8 ? judge.break(ph.breakPct) : null} />
              <Kpi label="Attack eff." value={eff3(team.attackEff)} sub={`${team.attempts} attacks`} tone={team.attempts >= 5 ? judge.eff(team.attackEff) : null} />
              <Kpi label="Pass avg" value={avg2(team.recAvg)} sub={`${team.receptions} passes`} tone={team.receptions >= 5 ? judge.passAvg(team.recAvg) : null} />
            </div>
            <Link to={`${base}/stats`} className="small">All stats ›</Link>
          </section>
        )}
        {leaders.length > 0 && (
          <section className="card dash-card">
            <h2 className="section-title">Leaders</h2>
            <table className="stat-table leaders">
              <tbody>
                {leaders.map((l) => (
                  <tr key={l.label}>
                    <td>{l.label}</td>
                    <td><Link to={`${base}/p/${l.player.id}`}><span className={`num-dot role-${l.player.role}`}>{l.player.number ?? '–'}</span> {l.player.name}</Link></td>
                    <td><b>{l.n}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {matches.length > 0 && (
          <section className="card dash-card">
            <h2 className="section-title">Tagged matches</h2>
            <ul className="dash-matches">
              {[...matches].reverse().map((m) => (
                <li key={m.id}><Link to={`${base}/m/${m.id}`}><span>{m.opponent ? `vs ${m.opponent}` : m.label}</span><small className="muted">{m.played_on}</small></Link></li>
              ))}
            </ul>
          </section>
        )}
      </aside>
      {game && <PublicGameSheet token={token} base={base} game={game} tagged={matches.some((m) => m.id === game.match_id)} onClose={() => setGame(null)} />}
    </div>
  );
}

/** One game for visitors: when and where, its video (or suggest one), its stats when tagged. */
function PublicGameSheet({ token, base, game, tagged, onClose }: { token: string; base: string; game: ScheduleGame; tagged: boolean; onClose: () => void }) {
  const v = game.video?.state === 'confirmed' ? game.video : null;
  const yt = v?.url ? parseYouTubeId(v.url) : null;
  const played = !!game.result || game.starts_at < new Date().toISOString().slice(0, 16);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet game-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>{game.home} – {game.away}</b><button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <dl className="game-facts">
          <dt>Date</dt><dd>{gameDay(game.starts_at)}, {gameTime(game.starts_at)}{game.cancelled ? ' (cancelled)' : ''}</dd>
          {game.result && <><dt>Result</dt><dd><b>{game.result}</b></dd></>}
          {game.league && <><dt>League</dt><dd>{game.league}</dd></>}
          {game.hall && <><dt>Hall</dt><dd>{game.hall}{game.address ? <><br /><a href={`https://maps.google.com/?q=${encodeURIComponent(game.address)}`} target="_blank" rel="noreferrer">{game.address}</a></> : null}</dd></>}
        </dl>
        {tagged && game.match_id && (
          <div className="game-actions">
            <Link className="btn btn-primary" to={`${base}/m/${game.match_id}`}>Stats of this game</Link>
            <Link className="btn" to={`${base}/m/${game.match_id}/replays`}>Replays</Link>
          </div>
        )}
        {v && (
          <>
            {yt ? (
              <div className="video-box"><iframe className="video-fill" src={`https://www.youtube-nocookie.com/embed/${yt}`} title={v.title ?? 'Video'} allow="fullscreen; picture-in-picture" allowFullScreen /></div>
            ) : null}
            <a href={v.url!} target="_blank" rel="noreferrer" className="small">{v.title || v.url}</a>
          </>
        )}
        {played && <SuggestVideoForm token={token} gameId={game.game_id} hasVideo={!!v} />}
      </div>
    </div>
  );
}

/** For visitors: send the link of a video of a game, with their shirt number; it shows once the team has checked it. */
export function SuggestVideoForm({ token, gameId, hasVideo }: { token: string; gameId: number; hasVideo: boolean }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [jersey, setJersey] = useState(() => { try { return localStorage.getItem('viq:jersey') ?? ''; } catch { return ''; } });
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setState('sending');
    try {
      await api.suggestVideo(token, gameId, { url: url.trim(), jersey: Number(jersey), note: note.trim() || undefined });
      try { localStorage.setItem('viq:jersey', jersey); } catch { /* private mode */ }
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setState('idle');
    }
  }
  if (state === 'sent') return <p className="small edit-notice">Thanks, the video was sent. It shows here once the team has checked it.</p>;
  if (!open) return <button className="btn-ghost small sched-more" onClick={() => setOpen(true)}>{hasVideo ? 'Know a better video of this game?' : 'Know a video of this game? Send the link'}</button>;
  return (
    <form className="form suggest-video" onSubmit={send}>
      <label className="field-label">Video link</label>
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" required />
      <div className="row">
        <div className="grow">
          <label className="field-label">Your shirt number</label>
          <input className="input" inputMode="numeric" value={jersey} onChange={(e) => setJersey(e.target.value.replace(/\D/g, '').slice(0, 2))} required />
        </div>
        <div className="grow">
          <label className="field-label">Note (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
      </div>
      {error && <p className="error small">{error}</p>}
      <button className="btn btn-primary" disabled={state === 'sending' || !url.trim() || !jersey}>{state === 'sending' ? 'Sending…' : 'Send'}</button>
    </form>
  );
}
