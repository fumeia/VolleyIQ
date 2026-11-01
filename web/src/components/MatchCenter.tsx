import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type CenterGame, type CenterQuery, type GameVideo, type VideoSuggestion, type YoutubeUsage } from '../lib/api';
import { VideoFinder } from './Schedule';
import { SuggestVideoForm } from './TeamOverview';
import { parseYouTubeId } from './VideoPlayer';

type Filters = { region: string; period: 'week' | 'range' | 'season'; week: string; from: string; to: string; gender: string; league: string; q: string; status: 'all' | 'played' | 'next'; videos: '' | 'check' | 'confirmed' };
const KEY = 'viq:center';
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
/** Monday of the week of [d]. */
const monday = (d: Date) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const season = () => { const d = new Date(); const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; return { from: `${y}-08-01`, to: `${y + 1}-07-31` }; };
const dayLabel = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const short = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const GENDER: Record<string, string> = { f: 'Women', m: 'Men', mixed: 'Mixed' };

function loadFilters(): Filters {
  const today = iso(new Date());
  const base: Filters = { region: '', period: 'week', week: monday(new Date()), from: addDays(today, -13), to: today, gender: '', league: '', q: '', status: 'all', videos: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // Older versions kept a single "only with video" switch.
    const videos = saved.videos ?? (saved.video ? 'confirmed' : '');
    return { ...base, ...saved, videos, week: monday(new Date()) };
  } catch { return base; }
}

/**
 * Every Swiss Volley game, any team: a week of all of Switzerland or a whole season of a
 * region, filtered by women / men, league, team and result; each game's video.
 * [token]: on the public team page (videos can be sent there, not searched).
 */
export function MatchCenter({ token }: { token?: string }) {
  const [f, setF] = useState<Filters>(loadFilters);
  const [data, setData] = useState<{ games: CenterGame[]; regions: { id: string; label: string }[]; videoSearch: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(150);
  const [game, setGame] = useState<CenterGame | null>(null);
  // On a phone the filters fold into one line; on a wider screen they stay open.
  const [open, setOpen] = useState(() => window.matchMedia?.('(min-width: 700px)').matches ?? true);
  const set = (p: Partial<Filters>) => setF((x) => {
    const n = { ...x, ...p };
    if (!n.region && n.period === 'season') n.period = 'week';
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ }
    return n;
  });

  const query: CenterQuery = f.period === 'season' && f.region ? { region: f.region, ...season() }
    : f.period === 'range' ? { region: f.region || null, from: f.from <= f.to ? f.from : f.to, to: f.from <= f.to ? f.to : f.from }
    : { region: f.region || null, from: f.week, to: addDays(f.week, 6) };
  const load = () => {
    setLoading(true); setError('');
    (token ? api.sharedCenter(token, query).then((r) => ({ ...r, videoSearch: false })) : api.center(query))
      .then((r) => { setData(r); setShown(150); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [query.region, query.from, query.to]);

  const leagues = useMemo(() => [...new Set((data?.games ?? []).filter((g) => !f.gender || g.gender === f.gender).map((g) => g.league ?? ''))].filter(Boolean).sort(), [data, f.gender]);
  const rows = useMemo(() => {
    const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (data?.games ?? []).filter((g) =>
      (!f.gender || g.gender === f.gender)
      && (!f.league || g.league === f.league)
      && (f.status === 'all' || (f.status === 'played' ? !!g.result : !g.result))
      && (!f.videos || g.videoState === (f.videos === 'check' ? 'found' : 'confirmed'))
      && words.every((w) => `${g.home} ${g.away} ${g.league ?? ''} ${g.group ?? ''} ${g.hall ?? ''} ${g.city ?? ''}`.toLowerCase().includes(w)))
      .sort((a, b) => (a.start < b.start ? -1 : 1));
  }, [data, f]);
  const days = useMemo(() => {
    const out: [string, CenterGame[]][] = [];
    for (const g of rows.slice(0, shown)) {
      const d = g.start.slice(0, 10);
      if (out.at(-1)?.[0] !== d) out.push([d, []]);
      out.at(-1)![1].push(g);
    }
    return out;
  }, [rows, shown]);
  const withVideo = (data?.games ?? []).filter((g) => g.videoState === 'confirmed').length;
  // Found by the YouTube search, waiting to be checked.
  const toCheck = (data?.games ?? []).filter((g) => g.videoState === 'found').length;

  const regionName = f.region ? data?.regions.find((r) => r.id === f.region)?.label ?? f.region : 'All of Switzerland';
  const summary = [regionName, f.period === 'season' && f.region ? 'whole season' : `${short(query.from)} – ${short(query.to)}`,
    f.gender ? GENDER[f.gender] : null, f.league || null, f.status === 'played' ? 'results' : f.status === 'next' ? 'upcoming' : null,
    f.q.trim() ? `“${f.q.trim()}”` : null, f.videos === 'check' ? 'videos to check' : f.videos === 'confirmed' ? 'with video' : null].filter(Boolean).join(' · ');
  return (
    <div className="center-page">
      {!open && (
        <button className="filter-summary" onClick={() => setOpen(true)}>
          <span className="grow">{summary}</span><b>Filters</b>
        </button>
      )}
      {open && <section className="filter-panel">
        <div className="filter-row">
          <label className="filter"><span>Region</span>
            <select className="input" value={f.region} onChange={(e) => set({ region: e.target.value })}>
              <option value="">All of Switzerland</option>
              {(data?.regions ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <div className="filter"><span>Period</span>
            <div className="seg">
              <button className={f.period === 'week' ? 'on' : ''} onClick={() => set({ period: 'week' })}>Week</button>
              <button className={f.period === 'range' ? 'on' : ''} onClick={() => set({ period: 'range' })}>Dates</button>
              <button className={f.period === 'season' && f.region ? 'on' : ''} disabled={!f.region} title={f.region ? '' : 'Pick a region first'} onClick={() => set({ period: 'season' })}>Season</button>
            </div>
          </div>
          {f.period === 'week' && (
            <div className="filter"><span>Week</span>
              <div className="week-nav">
                <button className="btn small" onClick={() => set({ week: addDays(f.week, -7) })} aria-label="Week before">‹</button>
                <b>{short(f.week)} – {short(addDays(f.week, 6))}</b>
                <button className="btn small" onClick={() => set({ week: addDays(f.week, 7) })} aria-label="Week after">›</button>
                {f.week !== monday(new Date()) && <button className="btn-ghost small" onClick={() => set({ week: monday(new Date()) })}>This week</button>}
              </div>
            </div>
          )}
          {f.period === 'range' && (
            <div className="filter"><span>From – to{f.region ? '' : ' (at most a month without a region)'}</span>
              <div className="week-nav">
                <input className="input" type="date" value={f.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
                <input className="input" type="date" value={f.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
                <button className="btn-ghost small" onClick={() => set({ from: addDays(iso(new Date()), -6), to: iso(new Date()) })}>Last 7 days</button>
                <button className="btn-ghost small" onClick={() => set({ from: addDays(iso(new Date()), -29), to: iso(new Date()) })}>Last 30 days</button>
              </div>
            </div>
          )}
        </div>
        <div className="filter-row">
          <div className="filter"><span>Teams</span>
            <div className="seg">
              {['', 'f', 'm'].map((g) => <button key={g} className={f.gender === g ? 'on' : ''} onClick={() => set({ gender: g, league: '' })}>{g ? GENDER[g] : 'All'}</button>)}
            </div>
          </div>
          <label className="filter"><span>League</span>
            <select className="input" value={f.league} onChange={(e) => set({ league: e.target.value })}>
              <option value="">All leagues</option>
              {leagues.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <div className="filter"><span>Games</span>
            <div className="seg">
              {(['all', 'played', 'next'] as const).map((s) => <button key={s} className={f.status === s ? 'on' : ''} onClick={() => set({ status: s })}>{s === 'all' ? 'All' : s === 'played' ? 'Results' : 'Upcoming'}</button>)}
            </div>
          </div>
        </div>
        <div className="filter-row">
          <label className="filter grow"><span>Search</span>
            <input className="input" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Team, hall or town" />
          </label>
          <div className="filter"><span>Videos</span>
            <div className="seg">
              <button className={!f.videos ? 'on' : ''} onClick={() => set({ videos: '' })}>All games</button>
              <button className={f.videos === 'check' ? 'on' : ''} onClick={() => set({ videos: 'check', status: 'all' })}>To check{toCheck ? ` (${toCheck})` : ''}</button>
              <button className={f.videos === 'confirmed' ? 'on' : ''} onClick={() => set({ videos: 'confirmed', status: 'all' })}>With video{withVideo ? ` (${withVideo})` : ''}</button>
            </div>
          </div>
        </div>
        <button className="btn btn-primary filter-done" onClick={() => setOpen(false)}>Show {rows.length} game{rows.length === 1 ? '' : 's'}</button>
      </section>}

      {!token && toCheck > 0 && f.videos !== 'check' && (
        <button className="to-check" onClick={() => { set({ videos: 'check', status: 'all' }); setOpen(false); }}>
          <b>{toCheck} possible video{toCheck === 1 ? '' : 's'} to check</b><span className="muted small">found by the YouTube search · show them</span>
        </button>
      )}
      {!token && data?.videoSearch && f.videos !== 'check' && <BulkSearch games={rows}
        onShow={() => { set({ videos: 'check', status: 'all' }); setOpen(false); }}
        onFound={(id, state) => setData((d) => d && { ...d, games: d.games.map((g) => (g.gameId === id ? { ...g, ...state } : g)) })} />}
      {!token && f.videos === 'check' && rows.length > 0 && <p className="small muted">Open a game to look at what the search found, then confirm the right video (or "None of these").</p>}

      <p className="small muted center-count">
        {loading ? 'Reading Swiss Volley…' : error ? '' : `${rows.length} game${rows.length === 1 ? '' : 's'}${rows.length !== (data?.games.length ?? 0) ? ` of ${data?.games.length}` : ''}`}
      </p>
      {error && <p className="error">{error}</p>}

      {days.map(([d, list]) => (
        <section key={d} className="center-day">
          <h3 className="center-day-head">{dayLabel(d)} <small className="muted">{list.length}</small></h3>
          <div className="table-wrap">
            <table className="stat-table center-table">
              <tbody>
                {list.map((g) => (
                  <tr key={g.gameId} onClick={() => setGame(g)}>
                    <td className="center-time">{g.start.slice(11, 16) === '00:00' ? '' : g.start.slice(11, 16)}</td>
                    <td className="sched-game">
                      <span>{g.home}</span><span className="sched-vs">{g.away}</span>
                      <small className="muted">{[g.league, g.gender ? GENDER[g.gender] : null, g.city].filter(Boolean).join(' · ')}</small>
                      {(g.videoState || g.sent || g.match_id) ? (
                        <span className="sched-flags">
                          {g.match_id ? <span className="badge badge-pending">tagged</span> : null}
                          {g.videoState === 'confirmed' ? <span className="badge">video</span> : g.videoState === 'found' ? <span className="badge badge-suggest" title="Found by the YouTube search, not checked yet">possible video</span> : null}
                          {g.sent ? <span className="badge badge-suggest">{g.sent} video{g.sent === 1 ? '' : 's'} sent</span> : null}
                        </span>
                      ) : null}
                    </td>
                    <td className="center-result">{g.result ? <b>{g.result}</b> : null}{g.sets.length > 0 && <small className="muted">{g.sets.join(' ')}</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {rows.length > shown && <button className="btn" onClick={() => setShown(shown + 300)}>Show more ({rows.length - shown} left)</button>}
      {!loading && !error && data && rows.length === 0 && <p className="muted">No games for these filters.</p>}

      {game && <CenterSheet game={game} token={token} videoSearch={!!data?.videoSearch} onClose={() => setGame(null)}
        onChanged={(state) => setData((d) => d && { ...d, games: d.games.map((g) => (g.gameId === game.gameId ? { ...g, ...state } : g)) })} />}
    </div>
  );
}

/** One game of the match center: details, video (search, confirm or send one), tag it. */
function CenterSheet({ game, token, videoSearch, onClose, onChanged }: {
  game: CenterGame; token?: string; videoSearch: boolean; onClose: () => void; onChanged: (g: Partial<CenterGame>) => void;
}) {
  const [video, setVideo] = useState<GameVideo | null | undefined>(undefined);
  const [sent, setSent] = useState<VideoSuggestion[]>([]);
  useEffect(() => {
    if (token) api.sharedGameVideo(token, game.gameId).then((r) => setVideo(r.video)).catch(() => setVideo(null));
    else api.gameVideo(game.gameId).then((r) => { setVideo(r.video); setSent(r.suggestions); }).catch(() => setVideo(null));
  }, [game.gameId]);
  const changed = (v: GameVideo | null) => { setVideo(v); onChanged({ videoState: v?.state === 'confirmed' ? 'confirmed' : v?.state === 'found' ? 'found' : null }); };
  const decide = async (id: number, decision: 'accept' | 'reject') => {
    const r = await api.decideVideoSuggestion(id, decision);
    const left = sent.filter((x) => x.id !== id);
    setSent(left);
    if (r.video) changed(r.video);
    onChanged({ sent: left.length });
  };
  const confirmed = video?.state === 'confirmed' ? video : null;
  const yt = confirmed?.url ? parseYouTubeId(confirmed.url) : null;
  const played = !!game.result || game.start < new Date().toISOString().slice(0, 16);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet game-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>{game.home} – {game.away}</b><button className="btn-ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <dl className="game-facts">
          <dt>Date</dt><dd>{dayLabel(game.start.slice(0, 10))}{game.start.slice(11, 16) !== '00:00' ? `, ${game.start.slice(11, 16)}` : ''}</dd>
          {game.result && <><dt>Result</dt><dd><b>{game.result}</b>{game.sets.length > 0 && <span className="muted"> ({game.sets.join(', ')})</span>}</dd></>}
          <dt>League</dt><dd>{[game.league, game.gender ? GENDER[game.gender] : null, game.group && game.group !== game.phase ? game.group : game.phase].filter(Boolean).join(' · ')}</dd>
          {game.hall && <><dt>Hall</dt><dd>{game.hall}{game.city ? `, ${game.city}` : ''}</dd></>}
        </dl>
        {!token && game.match_id && <Link className="btn btn-primary" to={`/m/${game.match_id}`}>Open the tagged match</Link>}
        <h3 className="section-title">Video</h3>
        {video === undefined ? <p className="small muted">…</p> : token ? (
          <>
            {confirmed && (yt
              ? <div className="video-box"><iframe className="video-fill" src={`https://www.youtube-nocookie.com/embed/${yt}`} title={confirmed.title ?? 'Video'} allow="fullscreen; picture-in-picture" allowFullScreen /></div>
              : <a href={confirmed.url!} target="_blank" rel="noreferrer">{confirmed.title || confirmed.url}</a>)}
            {!confirmed && !played && <p className="small muted">Not played yet.</p>}
            {played && <SuggestVideoForm token={token} gameId={game.gameId} hasVideo={!!confirmed} />}
          </>
        ) : (
          <>
            {sent.length > 0 && (
              <div className="video-finder">
                <p className="small">Sent by visitors of the public page:</p>
                {sent.map((x) => (
                  <div key={x.id} className="video-pick">
                    <a href={x.url} target="_blank" rel="noreferrer"><b>{x.title || x.url}</b><small className="muted">{x.sender_jersey != null ? `#${x.sender_jersey}` : ''}{x.note ? ` · ${x.note}` : ''}</small></a>
                    <button className="btn small" onClick={() => decide(x.id, 'accept')}>Use</button>
                    <button className="btn-ghost small" onClick={() => decide(x.id, 'reject')} aria-label="Reject">✕</button>
                  </div>
                ))}
              </div>
            )}
            <VideoFinder gameId={game.gameId} game={{ home: game.home, away: game.away, start: game.start }} video={video} canSearch={videoSearch} onChange={changed} />
            {confirmed?.url && (
              <Link className="btn btn-primary" to={`/new?${new URLSearchParams({ date: game.start.slice(0, 10), video: confirmed.url, label: `${game.home} - ${game.away}`, opponent: game.home })}`}>Tag this video</Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Search YouTube for many games at once: the played games in the list that have no video and
 * were not searched yet, one after the other, as far as today's quota goes.
 */
function BulkSearch({ games, onFound, onShow }: { games: CenterGame[]; onFound: (gameId: number, g: Partial<CenterGame>) => void; onShow: () => void }) {
  const [usage, setUsage] = useState<YoutubeUsage | null>(null);
  const [run, setRun] = useState<{ done: number; total: number; found: number; stop: boolean; error?: string } | null>(null);
  const stopRef = useRef(false);
  // Asked again whenever a search run ends, so "searches left" is current.
  useEffect(() => { api.youtubeUsage().then(setUsage).catch(() => {}); }, [run?.stop]);
  const todo = games.filter((g) => g.result && g.videoState !== 'confirmed' && !g.searched);
  if (!usage?.enabled) return null;
  const n = Math.min(todo.length, usage.searchesLeft);
  async function start() {
    if (!confirm(`Search YouTube for ${n} game${n === 1 ? '' : 's'}? That uses ${n * 101} of the ${usage!.left.toLocaleString()} units left today.`)) return;
    stopRef.current = false;
    const list = todo.slice(0, n);
    let found = 0;
    setRun({ done: 0, total: list.length, found: 0, stop: false });
    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) break;
      const g = list[i];
      try {
        const v = await api.searchVideo(g.gameId, { home: g.home, away: g.away, start: g.start });
        if (v.candidates.length) found++;
        onFound(g.gameId, { searched: true, videoState: v.state === 'confirmed' ? 'confirmed' : v.state === 'found' ? 'found' : null });
      } catch (e) {
        setRun({ done: i, total: list.length, found, stop: true, error: e instanceof Error ? e.message : 'Failed' });
        return;
      }
      setRun({ done: i + 1, total: list.length, found, stop: false });
    }
    setRun((r) => r && { ...r, stop: true });
  }
  return (
    <div className="bulk-search">
      {run && !run.stop ? (
        <>
          <div className="progress"><div style={{ width: `${(run.done / run.total) * 100}%` }} /></div>
          <span className="small">Searching {run.done + 1} of {run.total} · possible videos for {run.found}</span>
          <button className="btn-ghost small" onClick={() => { stopRef.current = true; }}>Stop</button>
        </>
      ) : (
        <>
          <span className="small grow">
            {run && <><b>Searched {run.done} game{run.done === 1 ? '' : 's'}: possible videos for {run.found}.</b>{run.error ? <span className="error"> {run.error}</span> : null}<br /></>}
            {todo.length ? `${todo.length} played game${todo.length === 1 ? '' : 's'} in this list not searched yet.` : 'Every played game in this list was searched.'}
            {' '}<span className="muted">{usage.searchesLeft ? `${usage.searchesLeft} searches left today.` : `No searches left today (they come back at ${new Date(usage.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`}</span>
          </span>
          {run && run.found > 0 && <button className="btn btn-primary" onClick={onShow}>Show the {run.found} to check</button>}
          {n > 0 && <button className="btn" onClick={start}>Search YouTube for {n}</button>}
        </>
      )}
    </div>
  );
}
