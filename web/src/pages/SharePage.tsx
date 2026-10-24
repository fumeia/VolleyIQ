import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { StatsView } from '../components/StatsView';
import { api, type MatchBundle } from '../lib/api';
import { scoreBySet } from '../lib/stats';

export function SharePage() {
  const { token } = useParams();
  const [data, setData] = useState<MatchBundle | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.shared(token!).then(setData).catch((e) => setError(e.message));
  }, [token]);

  if (error) return <div className="center error">This report link is invalid or was revoked.</div>;
  if (!data) return <div className="center muted">Loading…</div>;
  const sets = scoreBySet(data.events);

  return (
    <div className="page share">
      <div className="brand"><img src="/icon.svg" alt="" /> VolleyIQ</div>
      <h1>{data.match.label}</h1>
      <p className="muted">{data.match.team_name} {data.match.opponent ? `vs ${data.match.opponent}` : ''} · {data.match.played_on}</p>
      {sets.length > 0 && (
        <div className="row wrap">
          {sets.map((s) => <span key={s.set} className="chip">Set {s.set}: {s.us}–{s.them}</span>)}
        </div>
      )}
      <StatsView players={data.players} events={data.events} />
    </div>
  );
}
