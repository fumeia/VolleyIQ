import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib/api';
import { MoreMenu } from './components/MoreMenu';
import { Icon } from './components/Icon';
import { AboutPage } from './pages/About';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { MatchPage } from './pages/MatchPage';
import { NewMatch } from './pages/NewMatch';
import { Reports } from './pages/Reports';
import { SharePage, TeamSharePage } from './pages/SharePage';
import { TeamPage } from './pages/TeamPage';
import { Teams } from './pages/Teams';
import { ScoutingReport } from './pages/ScoutingReport';
import { Scout } from './pages/Scout';
import { MatchCenter } from './components/MatchCenter';

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/teams', label: 'Teams', icon: 'teams' },
  { to: '/new', label: 'Tag', icon: 'tag' },
  { to: '/matches', label: 'Matches', icon: 'calendar' },
  { to: '/reports', label: 'Stats', icon: 'stats' },
];

export function App() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading');
  const location = useLocation();
  const isShare = location.pathname.startsWith('/s/');
  const isMatch = /^\/m\/\d+/.test(location.pathname);

  useEffect(() => {
    if (isShare) return;
    api.me().then((me) => setAuth(me.authenticated ? 'in' : 'out')).catch(() => setAuth('out'));
    const onUnauth = () => setAuth('out');
    window.addEventListener('viq:unauthorized', onUnauth);
    return () => window.removeEventListener('viq:unauthorized', onUnauth);
  }, [isShare]);

  if (isShare) {
    return (
      <Routes>
        <Route path="/s/t/:token" element={<TeamSharePage view="overview" />} />
        <Route path="/s/t/:token/stats" element={<TeamSharePage />} />
        <Route path="/s/t/:token/matches" element={<TeamSharePage view="matches" />} />
        <Route path="/s/t/:token/trends" element={<TeamSharePage view="trends" />} />
        <Route path="/s/t/:token/players" element={<TeamSharePage view="players" />} />
        <Route path="/s/t/:token/m/:matchId" element={<TeamSharePage />} />
        <Route path="/s/t/:token/m/:matchId/trends" element={<TeamSharePage view="trends" />} />
        <Route path="/s/t/:token/replays" element={<TeamSharePage view="replays" />} />
        <Route path="/s/t/:token/m/:matchId/replays" element={<TeamSharePage view="replays" />} />
        <Route path="/s/t/:token/p/:playerId" element={<TeamSharePage view="players" />} />
        <Route path="/s/:token" element={<SharePage />} />
      </Routes>
    );
  }
  if (auth === 'loading') return <div className="center muted">Loading…</div>;
  if (auth === 'out') return <Login onLogin={() => setAuth('in')} />;

  return (
    <div className={`shell ${isMatch ? 'shell-match' : ''}`}>
      {!isMatch && (
        <header className="topbar">
          <NavLink to="/" className="brand"><img src="/icon.svg" alt="" /> VolleyIQ</NavLink>
          <span className="grow" />
          <MoreMenu className="topbar-more" />
        </header>
      )}
      <aside className="sidebar">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="side-link">
            <Icon name={n.icon} /> <span>{n.label}</span>
          </NavLink>
        ))}
        <span className="grow" />
        <NavLink to="/about" className="side-link"><Icon name="info" /> <span>About</span></NavLink>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:id" element={<TeamPage />} />
          <Route path="/teams/:id/scouting" element={<ScoutingReport />} />
          <Route path="/new" element={<NewMatch />} />
          <Route path="/m/:id" element={<MatchPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/scout/:id" element={<Scout />} />
          <Route path="/matches" element={<div className="page"><header className="page-head"><h1>Matches</h1><span className="muted small">Every game in Swiss Volley</span></header><MatchCenter /></div>} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
      </main>
      {!isMatch && (
        <nav className="bottombar">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="bottom-link">
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
