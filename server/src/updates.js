// App updates from the GitHub releases of the repository the app is built from: the
// phone asks the server (it may not have access to a private repository), the server
// asks GitHub with an optional read-only token and passes the APK through.
//   UPDATE_REPO=owner/repo      the repository with the releases
//   UPDATE_GITHUB_TOKEN=...     only for a private repository (read access to its contents)
import { Readable } from 'node:stream';

const API = 'https://api.github.com';
const STABLE_APK = /^VolleyIQ\.apk$/;
const VERSIONED_APK = /^VolleyIQ-(.+)\.apk$/;

/** [fetchImpl] is injectable for tests. */
export function makeUpdates(env = {}, fetchImpl = globalThis.fetch) {
  const repo = /^[\w.-]+\/[\w.-]+$/.test(env.UPDATE_REPO ?? '') ? env.UPDATE_REPO : null;
  const headers = (accept = 'application/vnd.github+json') => ({
    Accept: accept,
    'User-Agent': 'VolleyIQ-server',
    ...(env.UPDATE_GITHUB_TOKEN ? { Authorization: `Bearer ${env.UPDATE_GITHUB_TOKEN}` } : {}),
  });

  async function release(channel) {
    const url = channel === 'test' ? `${API}/repos/${repo}/releases/tags/android-latest` : `${API}/repos/${repo}/releases/latest`;
    const res = await fetchImpl(url, { headers: headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status}${res.status === 401 || res.status === 403 ? ' (check UPDATE_GITHUB_TOKEN)' : ''}`);
    return res.json();
  }

  return {
    configured: !!repo,
    repo,
    /** The newest APK of a channel: { version, name, notes, published, size, assetId } or null. */
    async latest(channel) {
      if (!repo) return null;
      const r = await release(channel);
      if (!r) return null;
      const apks = (r.assets ?? []).filter((a) => VERSIONED_APK.test(a.name));
      let asset, version;
      if (channel === 'test') {
        // Test builds: the newest versioned APK (highest build number at the end of the name).
        const n = (a) => Number(a.name.match(/(\d+)\.apk$/)?.[1] ?? 0);
        asset = apks.sort((a, b) => n(b) - n(a))[0];
        version = asset?.name.match(VERSIONED_APK)?.[1];
      } else {
        asset = (r.assets ?? []).find((a) => STABLE_APK.test(a.name)) ?? apks[0];
        version = String(r.tag_name ?? '').replace(/^v/, '');
      }
      if (!asset || !version) return null;
      return { version, name: r.name, notes: String(r.body ?? '').slice(0, 2000), published: r.published_at, size: asset.size, assetId: asset.id };
    },
    /** The APK's bytes as a stream, for one asset of this repository's releases. */
    async download(assetId) {
      const res = await fetchImpl(`${API}/repos/${repo}/releases/assets/${assetId}`, { headers: headers('application/octet-stream'), redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`GitHub answered ${res.status}`);
      return { stream: Readable.fromWeb(res.body), size: Number(res.headers.get('content-length')) || null };
    },
  };
}
