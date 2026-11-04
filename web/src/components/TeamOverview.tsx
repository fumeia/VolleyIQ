import { useEffect, useMemo, useState } from 'react';
import { t } from '../lib/i18n';
import { Link } from 'react-router-dom';
import { api, type LiveScore, type Match, type Player, type ScheduleGame, type VEvent } from '../lib/api';
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
export function TeamOverview({ token, base, players, events, matches, teamName = '' }: { token: string; base: string; players: Player[]; events: VEvent[]; matches: Match[]; teamName?: string }) {
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
    return [top((s) => s.points, t('Points')), top((s) => s.kills, t('Kills')), top((s) => s.aces, t('Aces')), top((s) => s.blockPoints, t('Blocks'))].filter(Boolean) as { label: string; player: Player; n: number }[];
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
        <LiveCard token={token} name={teamName} />
        {next && (
          <button className="card next-game" onClick={() => setGame(next)} data-tour="next-game">
            <span className="kpi-label">{t('Next game')}</span>
            <b className="next-vs">{next.side === 'away' ? t('at {team}', { team: next.home ?? '' }) : t('vs {team}', { team: opp(next) ?? '' })}</b>
            <span>{gameDay(next.starts_at)}, {gameTime(next.starts_at)}{next.hall ? ` · ${next.hall}` : ''}</span>
            {next.league && <small className="muted">{next.league}</small>}
          </button>
        )}
        {games && games.length > 0 && (
          <section className="dash-games" data-tour="games">
            <h2 className="section-title">{t('Games')} {videos > 0 && <small className="muted">· {t('{n} with video', { n: videos })}</small>}</h2>
            <ScheduleTable games={games} limit={6} onPick={setGame} />
          </section>
        )}
        {games && games.length === 0 && matches.length === 0 && <p className="muted">{t('Nothing here yet.')}</p>}
      </div>

      <aside className="dash-side">
        {played.length > 0 && (
          <section className="card dash-card">
            <h2 className="section-title">{t('Season')}</h2>
            <div className="record"><b className="tone-good">{wins}</b> {t('won')} <span className="muted">·</span> <b className="tone-bad">{played.length - wins}</b> {t('lost')}</div>
            <div className="form-strip" aria-label="Last results">
              {played.slice(-8).map((g) => <span key={g.id} className={won(g) ? 'w' : 'l'} title={`${opp(g)} ${g.result}`}>{won(g) ? t('W') : t('L')}</span>)}
            </div>
          </section>
        )}
        {events.length > 0 && (
          <section className="card dash-card" data-tour="season-numbers">
            <h2 className="section-title">{t('From the tagged matches')}</h2>
            <div className="kpis kpis-2">
              <Kpi label={t('Side-out')} value={pct(ph.sideoutPct)} sub={`${ph.sideout.won}/${ph.sideout.n}`} tone={ph.sideout.n >= 8 ? judge.sideout(ph.sideoutPct) : null} />
              <Kpi label={t('Break point')} value={pct(ph.breakPct)} sub={`${ph.break.won}/${ph.break.n}`} tone={ph.break.n >= 8 ? judge.break(ph.breakPct) : null} />
              <Kpi label={t('Attack eff.')} value={eff3(team.attackEff)} sub={t('{n} attacks', { n: team.attempts })} tone={team.attempts >= 5 ? judge.eff(team.attackEff) : null} />
              <Kpi label={t('Pass avg')} value={avg2(team.recAvg)} sub={t('{n} passes', { n: team.receptions })} tone={team.receptions >= 5 ? judge.passAvg(team.recAvg) : null} />
            </div>
            <Link to={`${base}/stats`} className="small">{t('All stats')} ›</Link>
          </section>
        )}
        {leaders.length > 0 && (
          <section className="card dash-card">
            <h2 className="section-title">{t('Leaders')}</h2>
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
            <h2 className="section-title">{t('Tagged matches')}</h2>
            <ul className="dash-matches">
              {[...matches].reverse().map((m) => (
                <li key={m.id}><Link to={`${base}/m/${m.id}`}><span>{m.opponent ? t('vs {team}', { team: m.opponent }) : m.label}</span><small className="muted">{m.played_on}</small></Link></li>
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
          <dt>{t('Date')}</dt><dd>{gameDay(game.starts_at)}, {gameTime(game.starts_at)}{game.cancelled ? ` (${t('cancelled')})` : ''}</dd>
          {game.result && <><dt>{t('Result')}</dt><dd><b>{game.result}</b></dd></>}
          {game.league && <><dt>{t('League')}</dt><dd>{game.league}</dd></>}
          {game.hall && <><dt>{t('Hall')}</dt><dd>{game.hall}{game.address ? <><br /><a href={`https://maps.google.com/?q=${encodeURIComponent(game.address)}`} target="_blank" rel="noreferrer">{game.address}</a></> : null}</dd></>}
        </dl>
        {tagged && game.match_id && (
          <div className="game-actions">
            <Link className="btn btn-primary" to={`${base}/m/${game.match_id}`}>{t('Stats of this game')}</Link>
            <Link className="btn" to={`${base}/m/${game.match_id}/replays`}>{t('Replays')}</Link>
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
      setError(err instanceof Error ? err.message : t('Failed'));
      setState('idle');
    }
  }
  if (state === 'sent') return <p className="small edit-notice">{t('Thanks, the video was sent. It shows here once the team has checked it.')}</p>;
  if (!open) return <button className="btn-ghost small sched-more" onClick={() => setOpen(true)}>{hasVideo ? t('Know a better video of this game?') : t('Know a video of this game? Send the link')}</button>;
  return (
    <form className="form suggest-video" onSubmit={send}>
      <label className="field-label">{t('Video link')}</label>
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" required />
      <div className="row">
        <div className="grow">
          <label className="field-label">{t('Your shirt number')}</label>
          <input className="input" inputMode="numeric" value={jersey} onChange={(e) => setJersey(e.target.value.replace(/\D/g, '').slice(0, 2))} required />
        </div>
        <div className="grow">
          <label className="field-label">{t('Note (optional)')}</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
      </div>
      {error && <p className="error small">{error}</p>}
      <button className="btn btn-primary" disabled={state === 'sending' || !url.trim() || !jersey}>{state === 'sending' ? t('Sending…') : t('Send')}</button>
    </form>
  );
}

/** The score of the match being tagged right now (asked again every 15 seconds); nothing when no match is live. */
function LiveCard({ token, name }: { token: string; name: string }) {
  const [live, setLive] = useState<LiveScore | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = () => api.sharedLive(token).then((r) => { if (!stop) setLive(r.live); }).catch(() => {});
    tick();
    const timer = window.setInterval(tick, 15000);
    return () => { stop = true; clearInterval(timer); };
  }, [token]);
  if (!live) return null;
  // Three sets won by one side: the game is over (shown for 15 minutes after the last tag).
  const over = live.won >= 3 || live.lost >= 3;
  const cur = over ? null : [...live.sets].reverse().find((s) => !s.done) ?? null;
  const ago = Math.max(0, Math.round((Date.now() - Date.parse(live.updated)) / 60000));
  return (
    <section className="card live-card" aria-live="polite">
      <div className="row between">
        <span className={over ? 'live-dot over' : 'live-dot'}>{over ? t('Final') : t('Live')}</span>
        <small className="muted">{ago < 1 ? t('updated just now') : t('updated {n} min ago', { n: ago })}</small>
      </div>
      <div className="live-teams"><b>{live.match.ourName ?? (name || t('Us'))}</b><span className="live-sets">{live.won} : {live.lost}</span><b>{live.match.opponent ?? live.match.label}</b></div>
      {cur && <div className="live-score">{cur.us} : {cur.them} <small className="muted">{t('Set {n}', { n: cur.set })}</small></div>}
      {live.sets.filter((s) => s.done).length > 0 && (
        <div className="small muted">{live.sets.filter((s) => s.done).map((s) => `${s.us}:${s.them}`).join(', ')}</div>
      )}
    </section>
  );
}
