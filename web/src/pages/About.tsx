import { useEffect, useState } from 'react';
import { api, authToken, isApp, publicBase, serverBase, type AppRelease } from '../lib/api';
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
