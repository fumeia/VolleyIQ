import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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

/** Public season report for a team. */
export function TeamSharePage() {
  const { token } = useParams();
  const [data, setData] = useState<{ team: Pick<Team, 'id' | 'name'>; players: Player[]; matches: Match[]; events: VEvent[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.sharedTeam(token!).then(setData).catch(() => setError(true));
  }, [token]);

  if (error) return <div className="center error">This season link is invalid or was revoked.</div>;
  if (!data) return <div className="center muted">Loading…</div>;
  const events = data.events.map((e) => ({ ...e, status: 'confirmed' as const }));
  return (
    <div className="page share">
      <div className="brand"><img src="/icon.svg" alt="" /> VolleyIQ</div>
      <div className="share-hero">
        <h1>{data.team.name}</h1>
        <p className="muted">Season report · {data.matches.length} matches</p>
      </div>
      <SeasonReportView title={data.team.name} matches={data.matches} players={data.players} events={events} />
      <h2 className="section-title">Details</h2>
      <StatsView players={data.players} events={events} matches={data.matches} />
    </div>
  );
}
