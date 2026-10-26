import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PlayerLearning } from '../components/analysis/PlayerLearning';
import { roleName } from '../components/analysis/PlayersSection';
import { StatsView } from '../components/StatsView';
import { Replays } from '../components/Replays';
import { Tour } from '../components/Tour';
import { matchTour, playerTour, teamTour } from '../components/ShareTours';
import { api, type MatchBundle, type Match, type Player, type Team, type VEvent } from '../lib/api';
import { MatchReportView, SeasonReportView } from '../report/ReportViews';

/** Public, read-only match report for teammates: the stats first, the report images on their own tab. */
export function SharePage() {
  const { token } = useParams();
  const [data, setData] = useState<MatchBundle | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<'stats' | 'images'>('stats');

  useEffect(() => {
    api.shared(token!).then(setData).catch(() => setError(true));
  }, [token]);

  if (error) return <div className="center error">This report link is invalid or was revoked.</div>;
  if (!data) return <div className="center muted">Loading…</div>;
  const m = data.match;
  return (
    <div className="page share">
      <div className="brand"><img src="/icon.svg" alt="" /> VolleyIQ</div>
      <div className="share-hero">
        <h1>{m.opponent ? `${m.team_name ?? 'Us'} vs ${m.opponent}` : m.label}</h1>
        <p className="muted">{[m.played_on, m.opponent ? m.label : null].filter(Boolean).join(' · ')}</p>
      </div>
      <nav className="tabs public-tabs" data-tour="tabs">
        <button className={`tab ${view === 'stats' ? 'on' : ''}`} onClick={() => setView('stats')}>Stats</button>
        <button className={`tab ${view === 'images' ? 'on' : ''}`} onClick={() => setView('images')}>Report images</button>
      </nav>
      {view === 'stats'
        ? <StatsView players={data.players} events={data.events} matches={[data.match]} />
        : <MatchReportView match={m} players={data.players} events={data.events} />}
      <Tour id="match" steps={matchTour(m.opponent ? `${m.team_name ?? 'Us'} vs ${m.opponent}` : m.label)} />
    </div>
  );
}

type TeamShare = { team: Pick<Team, 'id' | 'name' | 'show_tips'>; players: Player[]; matches: Match[]; events: VEvent[] };
type View = 'stats' | 'trends' | 'players' | 'replays';

/**
 * The public team site (no login), under the one shareable team link:
 *   Stats   /s/t/:token[/m/:match]          the analysis tabs, for all matches or one
 *   Trends  /s/t/:token[/m/:match]/trends   the report images (season trends, or one match)
 *   Players /s/t/:token/players             everyone, and /p/:player for each learning page
 */
export function TeamSharePage({ view = 'stats' }: { view?: View }) {
  const { token, matchId, playerId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<TeamShare | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.sharedTeam(token!).then((d) => setData({ ...d, events: d.events.map((e) => ({ ...e, status: 'confirmed' as const })) })).catch(() => setError(true));
  }, [token]);
  useEffect(() => { window.scrollTo(0, 0); }, [view, matchId, playerId]);

  if (error) return <div className="center error">This link is invalid or was revoked.</div>;
  if (!data) return <div className="center muted">Loading…</div>;
  const base = `/s/t/${token}`;
  const match = matchId ? data.matches.find((m) => m.id === Number(matchId)) ?? null : null;
  const player = playerId ? data.players.find((p) => p.id === Number(playerId)) ?? null : null;
  const tab: View = player ? 'players' : view;
  const scope = match ? `${base}/m/${match.id}` : base;
  const events = match ? data.events.filter((e) => e.match_id === match.id) : data.events;
  const active = data.players
    .map((p) => ({ p, n: data.events.filter((e) => e.player_id === p.id).length }))
    .filter((r) => r.n > 0)
    .sort((a, b) => (a.p.number ?? 99) - (b.p.number ?? 99));
  const matchPicker = (to: (id: number | null) => string) => (
    <select className="input" value={match?.id ?? ''} onChange={(e) => navigate(to(e.target.value ? Number(e.target.value) : null))}>
      <option value="">All matches ({data.matches.length})</option>
      {[...data.matches].reverse().map((m) => <option key={m.id} value={m.id}>{m.played_on ?? ''} {m.opponent ?? m.label}</option>)}
    </select>
  );

  let body: React.ReactNode;
  if (player) {
    body = (
      <>
        <Link to={`${base}/players`} className="back-link">← All players</Link>
        <PlayerLearning player={player} players={data.players} events={data.events} matches={data.matches} showTips={!!data.team.show_tips}
          actions={<CopyLink label="🔗 Copy link" />} />
      </>
    );
  } else if (tab === 'players') {
    body = (
      <div className="player-list">
        {active.map(({ p, n }) => (
          <Link key={p.id} to={`${base}/p/${p.id}`} className="card player-link">
            <span className={`num-dot role-${p.role}`}>{p.number ?? '–'}</span>
            <span className="grow"><b>{p.name}</b><small className="muted">{roleName(p.role)} · {n} touches</small></span>
            <span className="muted">›</span>
          </Link>
        ))}
      </div>
    );
  } else if (tab === 'replays') {
    body = <Replays token={token!} matches={data.matches} players={data.players} events={data.events} initialMatch={match?.id ?? null} />;
  } else if (tab === 'trends') {
    body = (
      <>
        <div className="row wrap" data-tour="match-picker">{matchPicker((id) => (id ? `${base}/m/${id}/trends` : `${base}/trends`))}</div>
        {match
          ? <MatchReportView match={{ ...match, team_name: data.team.name }} players={data.players} events={events} />
          : <SeasonReportView title={data.team.name} matches={data.matches} players={data.players} events={data.events} />}
      </>
    );
  } else {
    body = (
      <>
        <div className="row wrap" data-tour="match-picker">{matchPicker((id) => (id ? `${base}/m/${id}` : base))}</div>
        <StatsView players={data.players} events={events} matches={match ? [match] : data.matches} />
      </>
    );
  }

  return (
    <div className="page share">
      <header className="public-head">
        <Link to={base} className="brand"><img src="/icon.svg" alt="" /> {data.team.name}</Link>
        <span className="muted small">{data.matches.length} match{data.matches.length === 1 ? '' : 'es'}</span>
      </header>
      <nav className="tabs public-tabs" data-tour="tabs">
        <Link to={scope} className={`tab ${tab === 'stats' ? 'on' : ''}`}>Stats</Link>
        <Link to={`${scope}/trends`} className={`tab ${tab === 'trends' ? 'on' : ''}`}>Trends</Link>
        <Link to={`${base}/players`} className={`tab ${tab === 'players' ? 'on' : ''}`} data-tour="tab-players">Players</Link>
        <Link to={`${scope}/replays`} className={`tab ${tab === 'replays' ? 'on' : ''}`} data-tour="tab-replays">Replays</Link>
      </nav>
      {body}
      {/* Someone opening a player's own link gets that page's tour; everyone else the team's. */}
      {player ? <Tour key="player" id="player" steps={playerTour(player.name.split(' ')[0])} /> : <Tour key="team" id="team" steps={teamTour(data.team.name)} />}
    </div>
  );
}

function CopyLink({ label }: { label: string }) {
  return (
    <button className="btn small" onClick={async () => {
      const url = window.location.href;
      if (navigator.share) navigator.share({ url }).catch(() => {});
      else { await navigator.clipboard.writeText(url); alert('Link copied'); }
    }}>{label}</button>
  );
}
