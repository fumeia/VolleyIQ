import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { MatchPage } from './pages/MatchPage';
import { NewMatch } from './pages/NewMatch';
import { Reports } from './pages/Reports';
import { SharePage, TeamSharePage } from './pages/SharePage';
import { TeamPage } from './pages/TeamPage';
import { Teams } from './pages/Teams';

const NAV = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/teams', label: 'Teams', icon: '👥' },
  { to: '/new', label: 'Tag', icon: '＋' },
  { to: '/reports', label: 'Stats', icon: '📊' },
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
        <Route path="/s/t/:token" element={<TeamSharePage />} />
        <Route path="/s/t/:token/trends" element={<TeamSharePage view="trends" />} />
        <Route path="/s/t/:token/players" element={<TeamSharePage view="players" />} />
        <Route path="/s/t/:token/m/:matchId" element={<TeamSharePage />} />
        <Route path="/s/t/:token/m/:matchId/trends" element={<TeamSharePage view="trends" />} />
        <Route path="/s/t/:token/p/:playerId" element={<TeamSharePage view="players" />} />
        <Route path="/s/:token" element={<SharePage />} />
      </Routes>
    );
  }
  if (auth === 'loading') return <div className="center muted">Loading…</div>;
  if (auth === 'out') return <Login onLogin={() => setAuth('in')} />;

  return (
    <div className={`shell ${isMatch ? 'shell-match' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><img src="/icon.svg" alt="" /> VolleyIQ</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="side-link">
            <span className="side-icon">{n.icon}</span> {n.label}
          </NavLink>
        ))}
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:id" element={<TeamPage />} />
          <Route path="/new" element={<NewMatch />} />
          <Route path="/m/:id" element={<MatchPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
      </main>
      {!isMatch && (
        <nav className="bottombar">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="bottom-link">
              <span className="bottom-icon">{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
