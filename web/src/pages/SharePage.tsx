import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PlayerLearning } from '../components/analysis/PlayerLearning';
import { StatsView } from '../components/StatsView';
import { api, type MatchBundle, type Match, type Player, type Team, type VEvent } from '../lib/api';
import { MatchReportView, SeasonReportView } from '../report/ReportViews';

/** Public, read-only match report for teammates: shareable images first, interactive details below. */
export function SharePage() {
  const { token } = useParams();
  const [data, setData] = useState<MatchBundle | null>(null);
  const [error, setError] = useState(false);

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
      <MatchReportView match={m} players={data.players} events={data.events} />
      <h2 className="section-title">Details</h2>
      <StatsView players={data.players} events={data.events} matches={[data.match]} />
    </div>
  );
}

type TeamShare = { team: Pick<Team, 'id' | 'name' | 'show_tips'>; players: Player[]; matches: Match[]; events: VEvent[] };

/**
 * The public team site (no login): season overview, every match, and a learning page
 * per player, all under the one shareable team link.
 */
export function TeamSharePage() {
  const { token, matchId, playerId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<TeamShare | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.sharedTeam(token!).then((d) => setData({ ...d, events: d.events.map((e) => ({ ...e, status: 'confirmed' as const })) })).catch(() => setError(true));
  }, [token]);
  useEffect(() => { window.scrollTo(0, 0); }, [matchId, playerId]);

  if (error) return <div className="center error">This link is invalid or was revoked.</div>;
  if (!data) return <div className="center muted">Loading…</div>;
  const base = `/s/t/${token}`;
  const active = data.players.filter((p) => data.events.some((e) => e.player_id === p.id))
    .sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
  const match = matchId ? data.matches.find((m) => m.id === Number(matchId)) : null;
  const player = playerId ? data.players.find((p) => p.id === Number(playerId)) : null;

  let body: React.ReactNode;
  if (player) {
    body = <PlayerLearning player={player} players={data.players} events={data.events} matches={data.matches} showTips={!!data.team.show_tips}
      actions={<CopyLink label="🔗 Copy link" />} />;
  } else if (match) {
    const events = data.events.filter((e) => e.match_id === match.id);
    body = (
      <>
        <div className="share-hero">
          <h1>{match.opponent ? `${data.team.name} vs ${match.opponent}` : match.label}</h1>
          <p className="muted">{[match.played_on, match.opponent ? match.label : null].filter(Boolean).join(' · ')}</p>
        </div>
        <MatchReportView match={{ ...match, team_name: data.team.name }} players={data.players} events={events} />
        <h2 className="section-title">Details</h2>
        <StatsView players={data.players} events={events} matches={[match]} />
      </>
    );
  } else {
    body = (
      <>
        <div className="share-hero">
          <h1>{data.team.name}</h1>
          <p className="muted">Season · {data.matches.length} match{data.matches.length === 1 ? '' : 'es'}</p>
        </div>
        <SeasonReportView title={data.team.name} matches={data.matches} players={data.players} events={data.events} />
        <h2 className="section-title">Details</h2>
        <StatsView players={data.players} events={data.events} matches={data.matches} />
      </>
    );
  }

  return (
    <div className="page share">
      <header className="public-head">
        <Link to={base} className="brand"><img src="/icon.svg" alt="" /> {data.team.name}</Link>
        <nav className="public-nav">
          <Link to={base} className={!match && !player ? 'on' : ''}>Season</Link>
          <select className="input" value={match?.id ?? ''} onChange={(e) => e.target.value && navigate(`${base}/m/${e.target.value}`)}>
            <option value="">Matches…</option>
            {[...data.matches].reverse().map((m) => <option key={m.id} value={m.id}>{m.played_on ?? ''} {m.opponent ?? m.label}</option>)}
          </select>
          <select className="input" value={player?.id ?? ''} onChange={(e) => e.target.value && navigate(`${base}/p/${e.target.value}`)}>
            <option value="">Players…</option>
            {active.map((p) => <option key={p.id} value={p.id}>#{p.number ?? '–'} {p.name}</option>)}
          </select>
        </nav>
      </header>
      {!player && !match && active.length > 0 && (
        <div className="player-chips">
          <span className="muted small">Learning page per player:</span>
          {active.map((p) => <Link key={p.id} to={`${base}/p/${p.id}`} className="chip">#{p.number ?? '–'} {p.name}</Link>)}
        </div>
      )}
      {body}
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
