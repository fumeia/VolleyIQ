import { useEffect, useState } from 'react';
import { getLang, publicLanguage, setLang, t } from '../lib/i18n';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PlayerLearning } from '../components/analysis/PlayerLearning';
import { roleName } from '../components/analysis/PlayersSection';
import { StatsView } from '../components/StatsView';
import { Replays } from '../components/Replays';
import { Tour } from '../components/Tour';
import { matchTour, playerTour, statsTour, teamTour } from '../components/ShareTours';
import { TeamOverview } from '../components/TeamOverview';
import { MatchCenter } from '../components/MatchCenter';
import { api, type MatchBundle, type Match, type Player, type Playlist, type Team, type VEvent } from '../lib/api';
import { MatchReportView, SeasonReportView } from '../report/ReportViews';

/** Public, read-only match report for teammates: the stats first, the report images on their own tab. */
export function SharePage() {
  publicLanguage();
  const { token } = useParams();
  const [data, setData] = useState<MatchBundle | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<'stats' | 'images'>('stats');

  useEffect(() => {
    api.shared(token!).then(setData).catch(() => setError(true));
  }, [token]);

  if (error) return <div className="center error">{t('This report link is invalid or was revoked.')}</div>;
  if (!data) return <div className="center muted">Loading…</div>;
  const m = data.match;
  return (
    <div className="public">
      <header className="public-bar">
        <div className="public-inner">
          <span className="brand"><img src="/icon.svg" alt="" /> {m.opponent ? `${m.team_name ?? 'Us'} vs ${m.opponent}` : m.label}</span>
          <span className="public-sub">{[m.played_on, m.opponent ? m.label : null].filter(Boolean).join(' · ')}</span><LangSwitch />
        </div>
      </header>
      <nav className="public-nav" data-tour="tabs">
        <div className="public-inner tabs">
          <button className={`tab ${view === 'stats' ? 'on' : ''}`} onClick={() => setView('stats')}>{t('Stats')}</button>
          <button className={`tab ${view === 'images' ? 'on' : ''}`} onClick={() => setView('images')}>{t('Report images')}</button>
        </div>
      </nav>
      <div className="page share">
      {view === 'stats'
        ? <StatsView players={data.players} events={data.events} matches={[data.match]} />
        : <MatchReportView match={m} players={data.players} events={data.events} />}
      </div>
      <Tour id="match" steps={matchTour(m.opponent ? `${m.team_name ?? 'Us'} vs ${m.opponent}` : m.label)} />
    </div>
  );
}

type TeamShare = { team: Pick<Team, 'id' | 'name' | 'show_tips'>; players: Player[]; matches: Match[]; events: VEvent[]; playlists?: Playlist[] };
type View = 'overview' | 'stats' | 'trends' | 'players' | 'replays' | 'matches';

/**
 * The public team site (no login), under the one shareable team link:
 *   Stats   /s/t/:token[/m/:match]          the analysis tabs, for all matches or one
 *   Trends  /s/t/:token[/m/:match]/trends   the report images (season trends, or one match)
 *   Players /s/t/:token/players             everyone, and /p/:player for each learning page
 */
export function TeamSharePage({ view = 'stats' }: { view?: View }) {
  publicLanguage();
  const { token, matchId, playerId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<TeamShare | null>(null);
  // The viewer's own choice for the practice tips (remembered on this device); until they pick, the team's setting.
  const [tips, setTips] = useState<boolean | null>(() => { try { const v = localStorage.getItem('viq:showTips'); return v == null ? null : v === '1'; } catch { return null; } });
  const [error, setError] = useState(false);

  useEffect(() => {
    api.sharedTeam(token!).then((d) => setData({ ...d, events: d.events.map((e) => ({ ...e, status: 'confirmed' as const })) })).catch(() => setError(true));
  }, [token]);
  useEffect(() => { window.scrollTo(0, 0); }, [view, matchId, playerId]);

  if (error) return <div className="center error">{t('This link is invalid or was revoked.')}</div>;
  if (!data) return <div className="center muted">Loading…</div>;
  const base = `/s/t/${token}`;
  const match = matchId ? data.matches.find((m) => m.id === Number(matchId)) ?? null : null;
  const player = playerId ? data.players.find((p) => p.id === Number(playerId)) ?? null : null;
  const tab: View = player ? 'players' : view;
  const scope = match ? `${base}/m/${match.id}` : base;
  const statsLink = match ? scope : `${base}/stats`;
  const events = match ? data.events.filter((e) => e.match_id === match.id) : data.events;
  const active = data.players
    .map((p) => ({ p, n: data.events.filter((e) => e.player_id === p.id).length }))
    .filter((r) => r.n > 0)
    .sort((a, b) => (a.p.number ?? 99) - (b.p.number ?? 99));
  const matchPicker = (to: (id: number | null) => string) => (
    <select className="input" value={match?.id ?? ''} onChange={(e) => navigate(to(e.target.value ? Number(e.target.value) : null))}>
      <option value="">{t('All matches ({n})', { n: data.matches.length })}</option>
      {[...data.matches].reverse().map((m) => <option key={m.id} value={m.id}>{m.played_on ?? ''} {m.opponent ?? m.label}</option>)}
    </select>
  );

  let body: React.ReactNode;
  if (player) {
    body = (
      <>
        <Link to={`${base}/players`} className="back-link">← {t('All players')}</Link>
        <PlayerLearning player={player} players={data.players} events={data.events} matches={data.matches} showTips={tips ?? !!data.team.show_tips}
          tipsToggle={
            <label className="toggle small" data-tour="tips">
              <input type="checkbox" checked={tips ?? !!data.team.show_tips} onChange={(e) => {
                setTips(e.target.checked);
                try { localStorage.setItem('viq:showTips', e.target.checked ? '1' : '0'); } catch { /* private mode */ }
              }} /> {t('Show practice tips')}
            </label>
          }
          actions={<CopyLink label={t('Copy link')} />} />
      </>
    );
  } else if (tab === 'players') {
    body = (
      <div className="player-list">
        {active.map(({ p, n }) => (
          <Link key={p.id} to={`${base}/p/${p.id}`} className="card player-link">
            <span className={`num-dot role-${p.role}`}>{p.number ?? '–'}</span>
            <span className="grow"><b>{p.name}</b><small className="muted">{t(roleName(p.role))} · {t('{n} touches', { n })}</small></span>
            <span className="muted">›</span>
          </Link>
        ))}
      </div>
    );
  } else if (tab === 'replays') {
    body = <Replays token={token!} matches={data.matches} players={data.players} events={data.events} initialMatch={match?.id ?? null} playlists={data.playlists ?? []} />;
  } else if (tab === 'trends') {
    body = (
      <>
        <div className="row wrap" data-tour="match-picker">{matchPicker((id) => (id ? `${base}/m/${id}/trends` : `${base}/trends`))}</div>
        {match
          ? <MatchReportView match={{ ...match, team_name: data.team.name }} players={data.players} events={events} />
          : <SeasonReportView title={data.team.name} matches={data.matches} players={data.players} events={data.events} />}
      </>
    );
  } else if (tab === 'matches') {
    body = <MatchCenter token={token!} />;
  } else if (tab === 'overview') {
    body = <TeamOverview token={token!} base={base} players={data.players} events={data.events} matches={data.matches} teamName={data.team.name} />;
  } else {
    body = (
      <>
        <div className="row wrap" data-tour="match-picker">{matchPicker((id) => (id ? `${base}/m/${id}` : `${base}/stats`))}</div>
        <StatsView players={data.players} events={events} matches={match ? [match] : data.matches} />
      </>
    );
  }

  return (
    <div className="public">
      <header className="public-bar">
        <div className="public-inner">
          <Link to={base} className="brand"><img src="/icon.svg" alt="" /> {data.team.name}</Link>
          <span className="public-sub">{data.matches.length === 1 ? t('1 match') : t('{n} matches', { n: data.matches.length })}</span><LangSwitch />
        </div>
      </header>
      <nav className="public-nav" data-tour="tabs">
        <div className="public-inner tabs">
          <Link to={base} className={`tab ${tab === 'overview' ? 'on' : ''}`}>{t('Overview')}</Link>
          <Link to={statsLink} className={`tab ${tab === 'stats' ? 'on' : ''}`}>{t('Stats')}</Link>
          <Link to={`${scope}/trends`} className={`tab ${tab === 'trends' ? 'on' : ''}`}>{t('Trends')}</Link>
          <Link to={`${base}/players`} className={`tab ${tab === 'players' ? 'on' : ''}`} data-tour="tab-players">{t('Players')}</Link>
          <Link to={`${scope}/replays`} className={`tab ${tab === 'replays' ? 'on' : ''}`} data-tour="tab-replays">{t('Replays')}</Link>
          <Link to={`${base}/matches`} className={`tab ${tab === 'matches' ? 'on' : ''}`}>{t('All games')}</Link>
        </div>
      </nav>
      <div className="page share">
        {body}
      </div>
      {/* Someone opening a player's own link gets that page's tour; the front page the team's; the stats their own. */}
      {player ? <Tour key="player" id="player" steps={playerTour(player.name.split(' ')[0])} />
        : tab === 'overview' ? <Tour key="team" id="team" steps={teamTour(data.team.name)} />
        : tab === 'stats' ? <Tour key="stats" id="stats" steps={statsTour()} /> : null}
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

/** Deutsch / English for the public pages (remembered on the device). */
function LangSwitch() {
  const lang = getLang();
  return (
    <span className="lang-switch">
      <button className={lang === 'de' ? 'on' : ''} onClick={() => lang !== 'de' && setLang('de')}>DE</button>
      <button className={lang === 'en' ? 'on' : ''} onClick={() => lang !== 'en' && setLang('en')}>EN</button>
    </span>
  );
}
