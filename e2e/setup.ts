import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASE = 'http://127.0.0.1:3977';
export const PASSWORD = 'e2e-password';
export const STATE = path.join(here, '.state.json');

/**
 * Starts the server on a fresh database and fills it through the API with a made-up team,
 * a match with tags (made just now, so the public page shows it as live) and a public link.
 */
export default async function setup() {
  const dist = path.join(here, '..', 'web', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build the web app first (cd web && npm run build)');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-e2e-'));
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(here, '..', 'server'),
    env: { ...process.env, DATA_DIR: dataDir, WEB_DIST: dist, PORT: '3977', HOST: '127.0.0.1', APP_PASSWORD: PASSWORD, SESSION_SECRET: 'e2e', NODE_ENV: 'production' },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* not up yet */ }
    if (i > 100) throw new Error('The server did not start');
    await new Promise((r) => setTimeout(r, 200));
  }

  const login = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  const { token } = await login.json();
  const api = async (method: string, url: string, body?: unknown) => {
    const r = await fetch(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
    return r.json();
  };

  const team = await api('POST', '/api/teams', { name: 'Testers Nord' });
  const roster: [string, number, string][] = [['Alex Probe', 1, 'S'], ['Kim Muster', 5, 'OH'], ['Noa Beispiel', 7, 'OH'], ['Jo Test', 9, 'MB'], ['Lou Demo', 12, 'OPP'], ['Sam Fiktiv', 17, 'L']];
  for (const [name, number, role] of roster) await api('POST', `/api/teams/${team.id}/players`, { name, number, role });
  const match = await api('POST', '/api/matches', { label: 'League match', opponent: 'Sample VC', team_id: team.id, video_type: 'youtube', video_ref: 'aaaaaaaaaaa', played_on: new Date().toISOString().slice(0, 10) });

  // 12 rallies of set 1: a pass, a set and an attack; #7 passes badly, #5 hits from zone 4 cross-court.
  let t = 10;
  const ev = (action: string, jersey: number | null, extra: Record<string, unknown> = {}) =>
    api('POST', `/api/matches/${match.id}/events`, { action, jersey, t: (t += 2), set_no: 1, ...extra });
  for (let i = 0; i < 12; i++) {
    const bad = i % 3 !== 0;
    await ev('receive', i % 2 ? 7 : 5, { value: i % 2 ? (bad ? 1 : 2) : 3, fx: 4, fy: 2, x: 6, y: 8 });
    await ev('set', 1, { fx: 6, fy: 8, x: 1, y: 8 });
    await ev(i % 4 === 3 ? 'attack_error' : 'kill', i % 2 ? 9 : 5, { fx: 1, fy: 7.5, x: 6, y: 15 });
    if (i % 5 === 4) await ev('opp_point', null);
  }
  const share = await api('POST', `/api/teams/${team.id}/share`, {});
  fs.writeFileSync(STATE, JSON.stringify({ pid: server.pid, dataDir, teamId: team.id, matchId: match.id, share: share.share_token }));
  server.unref();
}
