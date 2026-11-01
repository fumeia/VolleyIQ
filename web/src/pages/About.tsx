import { loadTheme, saveTheme, type ThemeChoice } from '../lib/theme';
import { useEffect, useState } from 'react';
import { api, authToken, isApp, publicBase, serverBase, type AppRelease, type BackupStatus, type YoutubeUsage } from '../lib/api';
import { Native } from '../lib/native';
import { compareVersions } from '../lib/version';

type Channel = 'stable' | 'test';
type AppInfo = Awaited<ReturnType<typeof Native.appInfo>>;
type About = Awaited<ReturnType<typeof api.about>>;

const CHANNEL_KEY = 'viq:updateChannel';
const loadChannel = (): Channel => { try { return localStorage.getItem(CHANNEL_KEY) === 'test' ? 'test' : 'stable'; } catch { return 'stable'; } };
const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

/** About this app and server, and (in the Android app) updates from the server. */
export function AboutPage() {
  const app = isApp();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [server, setServer] = useState<{ version?: string } | null>(null);
  const [about, setAbout] = useState<About | null>(null);
  const [channel, setChannel] = useState<Channel>(loadChannel);
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'done' | 'error'; latest?: AppRelease | null; configured?: boolean; error?: string }>({ state: 'idle' });
  const [progress, setProgress] = useState<number | null>(null);
  const [installError, setInstallError] = useState('');

  useEffect(() => {
    if (app) Native.appInfo().then(setInfo).catch(() => {});
    api.health().then(setServer).catch(() => setServer(null));
    api.about().then(setAbout).catch(() => {});
  }, [app]);

  async function checkUpdates(ch = channel) {
    setCheck({ state: 'checking' });
    try {
      const r = await api.appUpdate(ch);
      setCheck({ state: 'done', latest: r.latest, configured: r.configured });
    } catch (e) {
      setCheck({ state: 'error', error: e instanceof Error ? e.message : 'Check failed' });
    }
  }
  // Check once when the page opens (cheap: one request to your server).
  useEffect(() => { checkUpdates(); }, []);

  const installed = app ? info?.version : __APP_VERSION__;
  const latest = check.latest;
  const newer = !!latest && !!installed && compareVersions(latest.version, installed) > 0;

  async function install() {
    if (!latest) return;
    setInstallError('');
    setProgress(0);
    const sub = await Native.addListener('updateProgress', (p) => setProgress(p.total > 0 ? p.done / p.total : null));
    try {
      await Native.installUpdate({ url: `${serverBase()}/api/app/apk/${latest.assetId}`, token: authToken() });
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      sub.remove();
      setProgress(null);
    }
  }

  const row = (k: string, v: React.ReactNode) => <div className="about-row"><span className="muted">{k}</span><span>{v}</span></div>;

  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  return (
    <div className="page about">
      <header className="about-hero">
        <img src="/icon.svg" alt="" />
        <div><h1>VolleyIQ</h1><p className="muted">Volleyball tagging and analysis</p></div>
      </header>

      <section className="card">
        <h2 className="section-title">Version</h2>
        {app ? (
          <>
            {row('App', info ? `${info.version}` : '…')}
            {row('Build', info?.build ?? '…')}
            {row('Device', info ? `${info.device}, Android ${info.android}` : '…')}
          </>
        ) : row('Website', __APP_VERSION__)}
        {row('Server', server?.version ?? (server ? 'older than 1.0' : 'not reachable'))}
        {row('Server address', publicBase())}
      </section>

      <YoutubeQuota />
      <BackupCard />

      <section className="card">
        <h2 className="section-title">Appearance</h2>
        <div className="segmented">
          {(['light', 'dark', 'system'] as ThemeChoice[]).map((c) => (
            <button key={c} className={theme === c ? 'on' : ''} onClick={() => { setTheme(c); saveTheme(c); }}>
              {c === 'light' ? 'Light' : c === 'dark' ? 'Dark' : 'Like the device'}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Updates</h2>
        <div className="segmented">
          {(['stable', 'test'] as Channel[]).map((c) => (
            <button key={c} className={channel === c ? 'on' : ''} onClick={() => {
              setChannel(c);
              try { localStorage.setItem(CHANNEL_KEY, c); } catch { /* private mode */ }
              checkUpdates(c);
            }}>{c === 'stable' ? 'Releases' : 'Test builds'}</button>
          ))}
        </div>
        <p className="small muted">{channel === 'stable' ? 'Stable releases (recommended).' : 'Every new build, before it becomes a release. Can have rough edges.'}</p>
        {check.state === 'checking' && <p className="small muted">Checking…</p>}
        {check.state === 'error' && <p className="small error">{check.error}</p>}
        {check.state === 'done' && check.configured === false && (
          <p className="small muted">Updates are not set up on this server. Add <code>UPDATE_REPO=owner/repo</code> (and for a private repository <code>UPDATE_GITHUB_TOKEN</code>, a read-only token) to the server's <code>.env</code>; see the README.</p>
        )}
        {check.state === 'done' && check.configured && !latest && <p className="small muted">No {channel === 'stable' ? 'release' : 'test build'} found.</p>}
        {check.state === 'done' && latest && (
          newer ? (
            <div className="update-box">
              <b>Version {latest.version} is available</b>{installed && <span className="muted small"> · you have {installed}</span>}
              <span className="small muted">{mb(latest.size)}{latest.published ? ` · ${new Date(latest.published).toLocaleDateString()}` : ''}</span>
              {app ? (
                <>
                  <button className="btn btn-primary" disabled={progress != null} onClick={install}>
                    {progress != null ? `Downloading… ${progress == null ? '' : `${Math.round(progress * 100)}%`}` : '⬇ Download and install'}
                  </button>
                  {progress != null && <div className="progress"><div style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>}
                  <p className="small muted">{progress != null ? 'Downloads in the background with a notification, so you can switch to other apps; tap the notification to install when it is done. ' : ''}Android asks you to confirm the install. Your matches and login stay as they are.</p>
                </>
              ) : (
                <a className="btn btn-primary" href={`/api/app/apk/${latest.assetId}`}>⬇ Download the Android app ({latest.version})</a>
              )}
              {installError && <p className="small error">{installError}</p>}
            </div>
          ) : (
            <p className="small"><span className="tone-good">✓</span> {app ? `You have the newest ${channel === 'stable' ? 'release' : 'test build'} (${installed}).` : `Newest Android app: ${latest.version}.`}
              {!app && <> <a href={`/api/app/apk/${latest.assetId}`}>Download</a></>}</p>
          )
        )}
        <button className="btn-ghost small" disabled={check.state === 'checking'} onClick={() => checkUpdates()}>↻ Check again</button>
      </section>

      <section className="card">
        <h2 className="section-title">AI features</h2>
        {about ? (
          <>
            {row('Match sheet scan', about.ai.scan ? 'on' : 'off')}
            {row('Coach summary', about.ai.summary ? 'on' : 'off')}
            {row('Touch check in Review', about.ai.touches ? `on${about.ai.model ? ` (${about.ai.model})` : ''}` : 'off')}
            <p className="small muted">Set up on the server (<code>.env</code>). They only send data when you press their button.</p>
          </>
        ) : <p className="small muted">…</p>}
      </section>

      <section className="card">
        <h2 className="section-title">Your data</h2>
        <p className="small">Teams, players, matches and tags are stored only on your server ({publicBase()}). Videos stay on the device you tag on and are never uploaded. Public stats links show the stats of one team to anyone who has the link, until you revoke it.</p>
        {about?.updates.repo && <p className="small">Source code: <a href={`https://github.com/${about.updates.repo}`} target="_blank" rel="noreferrer">github.com/{about.updates.repo}</a></p>}
      </section>

    </div>
  );
}

/** What is left of today's free YouTube searches (for finding match videos). */
export function YoutubeQuota() {
  const [u, setU] = useState<YoutubeUsage | null>(null);
  useEffect(() => { api.youtubeUsage().then(setU).catch(() => {}); }, []);
  if (!u) return null;
  return (
    <section className="card">
      <h2 className="section-title">YouTube video search</h2>
      {!u.enabled ? <p className="small muted">Not set up on the server (YOUTUBE_API_KEY in .env).</p> : (
        <>
          <div className="row between"><b>{u.searchesLeft} searches left today</b><span className="small muted">{u.used.toLocaleString()} of {u.limit.toLocaleString()} units used</span></div>
          <div className="progress"><div style={{ width: `${Math.min(100, (u.used / u.limit) * 100)}%` }} /></div>
          <p className="small muted">Starts over at {new Date(u.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(u.resetsAt).toLocaleDateString()}). A search costs 101 of the 10,000 free units a day. Counted by VolleyIQ: searches with the same key elsewhere are not included.</p>
        </>
      )}
    </section>
  );
}

/** The nightly database backups in the bucket: when the last one ran, and one right now. */
function BackupCard() {
  const [b, setB] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => api.backupStatus().then(setB).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!b) return null;
  const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <section className="card">
      <h2 className="section-title">Backups</h2>
      {!b.enabled ? <p className="small muted">Backups go to the video bucket: set up the S3_ lines in the server's .env first. Until then, copy data/volleyiq.db yourself now and then.</p> : (
        <>
          {b.last?.ok ? <p className="small"><span className="tone-good">✓</span> Last backup {when(b.last.at)} · {Math.round((b.last.bytes ?? 0) / 1024)} KB</p>
            : b.last ? <p className="small error">Last backup failed ({when(b.last.at)}): {b.last.error}</p>
            : <p className="small muted">No backup yet.</p>}
          <p className="small muted">Every night around 3:00 the whole database (teams, tags, line-ups, settings) is copied into your bucket under backups/; the newest {b.backups.length > 0 ? `${b.backups.length} are` : '14 are'} kept. How to restore one: see the README.</p>
          <button className="btn" disabled={busy} onClick={async () => {
            setBusy(true); setError('');
            try { await api.backupNow(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
          }}>{busy ? 'Backing up…' : 'Back up now'}</button>
          {error && <p className="small error">{error}</p>}
        </>
      )}
    </section>
  );
}
