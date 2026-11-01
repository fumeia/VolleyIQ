import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type LeagueGame, type ScheduleGame } from '../lib/api';
import { gameDay, VideoFinder } from '../components/Schedule';

/** The other team's games this season (results, sets, videos), to prepare a game against them. */
export function Scout() {
  const { id } = useParams();
  const [game, setGame] = useState<ScheduleGame | null>(null);
  const [data, setData] = useState<{ opponent: string; games: LeagueGame[] } | null>(null);
  const [videoSearch, setVideoSearch] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [tab, setTab] = useState<'played' | 'next'>('played');
  const [error, setError] = useState('');

  useEffect(() => {
    api.schedule().then((s) => { setGame(s.games.find((g) => g.id === Number(id)) ?? null); setVideoSearch(s.videoSearch); });
    api.opponentGames(Number(id)).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, [id]);

  const opp = data?.opponent;
  const won = (g: LeagueGame) => {
    if (!g.result || !opp) return null;
    const [h, a] = g.result.split(':').map(Number);
    return (g.home === opp ? h > a : a > h);
  };
  const played = data?.games.filter((g) => g.result) ?? [];
  const next = (data?.games.filter((g) => !g.result) ?? []).slice().reverse();
  const rows = tab === 'played' ? played : next;
  return (
    <div className="page">
      <header className="page-head">
        <h1>{opp ?? 'Opponent'}</h1>
        {game && <span className="muted small">Next: {gameDay(game.starts_at)} · {game.home} – {game.away}</span>}
      </header>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Reading the league from Swiss Volley… (the first time this can take a few seconds)</p>}
      {data && (
        <>
          <p className="muted small">
            {played.length} game{played.length === 1 ? '' : 's'} played this season{played.length ? `: ${played.filter((g) => won(g)).length} won, ${played.filter((g) => won(g) === false).length} lost` : ''}.
            Tap a game for its video; with a video you can tag it like your own matches.
          </p>
          <nav className="tabs">
            <button className={`tab ${tab === 'played' ? 'on' : ''}`} onClick={() => setTab('played')}>Results <small>{played.length}</small></button>
            <button className={`tab ${tab === 'next' ? 'on' : ''}`} onClick={() => setTab('next')}>Upcoming <small>{next.length}</small></button>
          </nav>
          <div className="table-wrap">
            <table className="stat-table sched-table">
              <thead><tr><th>Date</th><th>Game</th><th>Sets</th><th aria-label="Video" /></tr></thead>
              <tbody>
                {rows.map((g) => (
                  <Fragment key={g.gameId}>
                    <tr onClick={() => setOpen(open === g.gameId ? null : g.gameId)} className={open === g.gameId ? 'on' : ''}>
                      <td><b>{gameDay(g.start)}</b></td>
                      <td className="sched-game"><span className={g.home === opp ? 'sched-us' : ''}>{g.home}</span><span className="sched-vs"><span className={g.away === opp ? 'sched-us' : ''}>{g.away}</span></span>
                        {g.sets.length > 0 && <small className="muted">{g.sets.join(', ')}</small>}</td>
                      <td>{g.result ? <b className={won(g) ? 'tone-good' : 'tone-bad'}>{g.result}</b> : <span className="muted">{g.start.slice(11, 16)}</span>}</td>
                      <td className="sched-flags">{g.video?.state === 'confirmed' ? <span className="badge">video</span> : null}</td>
                    </tr>
                    {open === g.gameId && (
                      <tr className="sched-detail"><td colSpan={4}>
                        <VideoFinder gameId={g.gameId} game={{ home: g.home, away: g.away, start: g.start }} video={g.video} canSearch={videoSearch}
                          onChange={(v) => setData((d) => d && { ...d, games: d.games.map((x) => (x.gameId === g.gameId ? { ...x, video: v } : x)) })} />
                        {g.video?.state === 'confirmed' && g.video.url && game && (
                          <Link className="btn btn-primary" to={`/new?${new URLSearchParams({
                            team: String(game.team_id), opponent: opp ?? '', date: g.start.slice(0, 10), video: g.video.url, label: `Scouting: ${g.home} - ${g.away}`,
                          })}`}>Tag this video</Link>
                        )}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
