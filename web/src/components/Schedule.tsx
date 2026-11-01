import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type GameVideo, type ScheduleGame } from '../lib/api';

/** "Sat 18 Oct" and "16:30" from a local Swiss time "2026-10-18T16:30". */
export const gameDay = (s: string) => new Date(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
export const gameTime = (s: string) => s.slice(11, 16);
const nowLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const mins = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')} h` : `${Math.round(sec / 60)} min`);

/** Did this team win? From the result in sets and which side it played. */
function outcome(g: ScheduleGame) {
  if (!g.result || !g.side) return null;
  const [h, a] = g.result.split(':').map(Number);
  return (g.side === 'home' ? h > a : a > h) ? 'won' : 'lost';
}

/** A team's games from Swiss Volley: what comes next, and the results so far. */
export function ScheduleTable({ games, showTeam = false, limit, onPick }: { games: ScheduleGame[]; showTeam?: boolean; limit?: number; onPick: (g: ScheduleGame) => void }) {
  const now = nowLocal();
  const upcoming = games.filter((g) => g.starts_at >= now.slice(0, 10) && !g.result);
  const played = games.filter((g) => !upcoming.includes(g)).reverse();
  const [tab, setTab] = useState<'next' | 'played'>(upcoming.length ? 'next' : 'played');
  const [all, setAll] = useState(false);
  const full = tab === 'next' ? upcoming : played;
  const rows = limit && !all ? full.slice(0, limit) : full;
  const name = (g: ScheduleGame, side: 'home' | 'away') => <span className={g.side === side ? 'sched-us' : ''}>{g[side]}</span>;
  return (
    <div className="sched">
      <nav className="tabs">
        <button className={`tab ${tab === 'next' ? 'on' : ''}`} onClick={() => setTab('next')}>Upcoming <small>{upcoming.length}</small></button>
        <button className={`tab ${tab === 'played' ? 'on' : ''}`} onClick={() => setTab('played')}>Results <small>{played.length}</small></button>
      </nav>
      {rows.length === 0 ? <p className="muted small sched-empty">{tab === 'next' ? 'No more games scheduled.' : 'No games played yet.'}</p> : (
        <div className="table-wrap">
          <table className="stat-table sched-table">
            <thead><tr><th>Date</th><th>Game</th><th>{tab === 'next' ? 'Time' : 'Sets'}</th><th aria-label="Tagged" /></tr></thead>
            <tbody>
              {rows.map((g) => {
                const o = outcome(g);
                return (
                  <tr key={g.id} onClick={() => onPick(g)} className={g.cancelled ? 'sched-cancelled' : ''}>
                    <td><b>{gameDay(g.starts_at)}</b>{showTeam && <small className="muted">{g.team_name}</small>}</td>
                    <td className="sched-game">{name(g, 'home')}<span className="sched-vs">{name(g, 'away')}</span>{g.league && <small className="muted">{g.league}{g.hall ? ` · ${g.hall}` : ''}</small>}</td>
                    <td>{g.cancelled ? <span className="muted">cancelled</span> : g.result ? <b className={o === 'won' ? 'tone-good' : o === 'lost' ? 'tone-bad' : ''}>{g.result}</b> : gameTime(g.starts_at)}</td>
                    <td className="sched-flags">{g.match_id ? <span className="badge badge-pending" title="Tagged in VolleyIQ">tagged</span> : g.video?.state === 'confirmed' ? <span className="badge" title="A video was found">video</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length < full.length && <button className="btn-ghost small sched-more" onClick={() => setAll(true)}>Show all {full.length}</button>}
    </div>
  );
}

/** One game: where and when, start tagging it, the other team's games, its video. */
export function GameSheet({ game, videoSearch, onClose, onChanged }: { game: ScheduleGame; videoSearch: boolean; onClose: () => void; onChanged: () => void }) {
  const opponent = (game.side === 'home' ? game.away : game.home) ?? '';
  const [video, setVideo] = useState<GameVideo | null>(game.video);
  const tagLink = `/new?${new URLSearchParams({
    team: String(game.team_id), opponent, date: game.starts_at.slice(0, 10), schedule: String(game.id),
    label: `${game.home} - ${game.away}`, ...(video?.state === 'confirmed' && video.url ? { video: video.url } : {}),
  })}`;
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
        <div className="game-actions">
          {game.match_id
            ? <Link className="btn btn-primary" to={`/m/${game.match_id}`}>Open the tagged match</Link>
            : <Link className="btn btn-primary" to={tagLink}>Tag this match</Link>}
          {game.league_id && <Link className="btn" to={`/scout/${game.id}`}>{opponent}: games this season</Link>}
        </div>
        <h3 className="section-title">Video</h3>
        <VideoFinder gameId={game.game_id} game={{ home: game.home ?? '', away: game.away ?? '', start: game.starts_at }} video={video} canSearch={videoSearch}
          onChange={(v) => { setVideo(v); onChanged(); }} />
      </div>
    </div>
  );
}

/** The video of a game: search YouTube, pick the right one, or paste a link. */
export function VideoFinder({ gameId, game, video, canSearch, onChange }: {
  gameId: number; game: { home: string; away: string; start: string }; video: GameVideo | null; canSearch: boolean; onChange: (v: GameVideo) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paste, setPaste] = useState('');
  const [choosing, setChoosing] = useState(false);
  const run = async (f: () => Promise<GameVideo>) => {
    setBusy(true); setError('');
    try { onChange(await f()); setChoosing(false); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  const played = Date.parse(game.start) < Date.now();
  if (video?.state === 'confirmed' && !choosing) {
    return (
      <div className="video-finder">
        <a href={video.url!} target="_blank" rel="noreferrer" className="video-pick on"><b>{video.title || video.url}</b><small className="muted">{video.url}</small></a>
        <button className="btn-ghost small" onClick={() => setChoosing(true)}>Change</button>
      </div>
    );
  }
  const list = video?.candidates ?? [];
  return (
    <div className="video-finder">
      {list.length > 0 && video?.state !== 'rejected' && (
        <>
          <p className="small muted">Possible videos, best first. Open one to check, then confirm it.</p>
          {list.map((c) => (
            <div key={c.id} className="video-pick">
              <a href={c.url} target="_blank" rel="noreferrer"><b>{c.title}</b><small className="muted">{c.channel} · {c.seconds ? mins(c.seconds) : 'live'} · {new Date(c.publishedAt).toLocaleDateString()}</small></a>
              <button className="btn small" disabled={busy} onClick={() => run(() => api.setVideo(gameId, { url: c.url, title: c.title }))}>This is it</button>
            </div>
          ))}
          <button className="btn-ghost small" disabled={busy} onClick={() => run(() => api.setVideo(gameId, { state: 'rejected' }))}>None of these</button>
        </>
      )}
      {video?.state === 'none' && <p className="small muted">No video found on YouTube{video.searched_at ? ` (searched ${new Date(`${video.searched_at.replace(' ', 'T')}Z`).toLocaleDateString()})` : ''}.</p>}
      {video?.state === 'rejected' && <p className="small muted">None of the videos found was this game.</p>}
      <div className="row wrap">
        {canSearch && played && <button className="btn" disabled={busy} onClick={() => run(() => api.searchVideo(gameId, game))}>{busy ? 'Searching…' : video?.searched_at ? 'Search YouTube again' : 'Search YouTube'}</button>}
        <form className="row grow" onSubmit={(e) => { e.preventDefault(); if (paste.trim()) run(() => api.setVideo(gameId, { url: paste.trim() })); }}>
          <input className="input grow" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="or paste a video link" />
          <button className="btn" disabled={busy || !paste.trim()}>Save</button>
        </form>
      </div>
      {!canSearch && played && <p className="small muted">Searching YouTube needs a YouTube key on the server (YOUTUBE_API_KEY, see the README).</p>}
      {!played && <p className="small muted">Not played yet.</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
