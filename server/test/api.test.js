import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/index.js';

async function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-'));
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none'), WORKER_TOKEN: 'wt', ...extra });
  return app;
}

test('team, roster, match, events and jersey resolution', async () => {
  const app = await setup();
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'U18' } })).json();
  const p = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/players`, payload: { name: 'Ana', number: 7, role: 'OH' } })).json();
  const match = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'vs X', team_id: team.id, video_type: 'youtube', video_ref: 'abc' } })).json();

  const e1 = (await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events`, payload: { action: 'kill', jersey: 7, zone: 4, t: 12.5, client_id: 'c1' } })).json();
  assert.equal(e1.player_id, p.id);
  const again = (await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events`, payload: { action: 'kill', jersey: 7, client_id: 'c1' } })).json();
  assert.equal(again.id, e1.id, 'client_id makes posting idempotent');

  const badRes = await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events`, payload: { action: 'nope' } });
  assert.equal(badRes.statusCode, 400);

  const patched = (await app.inject({ method: 'PATCH', url: `/api/events/${e1.id}`, payload: { action: 'attack_error', zone: null } })).json();
  assert.equal(patched.action, 'attack_error');
  assert.equal(patched.zone, null);

  const bundle = (await app.inject({ url: `/api/matches/${match.id}` })).json();
  assert.equal(bundle.events.length, 1);
  assert.equal(bundle.players.length, 1);
  await app.close();
});

test('worker job lifecycle creates suggested events', async () => {
  const app = await setup();
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } })).json();
  await app.inject({ method: 'POST', url: `/api/teams/${team.id}/players`, payload: { name: 'B', number: 3 } });
  const match = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'm', team_id: team.id, video_type: 'youtube', video_ref: 'yt' } })).json();
  const job = (await app.inject({ method: 'POST', url: `/api/matches/${match.id}/analyze`, payload: {} })).json();
  assert.equal(job.status, 'queued');

  assert.equal((await app.inject({ method: 'POST', url: '/api/worker/claim' })).statusCode, 401);
  const claim = (await app.inject({ method: 'POST', url: '/api/worker/claim', headers: { authorization: 'Bearer wt' } })).json();
  assert.equal(claim.job.id, job.id);
  assert.equal(claim.players.length, 1);

  const fin = (await app.inject({
    method: 'POST', url: `/api/worker/jobs/${job.id}/finish`, headers: { authorization: 'Bearer wt' },
    payload: { events: [{ action: 'serve', t: 3, jersey: 3, confidence: 0.6 }, { action: 'bogus', t: 4 }] },
  })).json();
  assert.equal(fin.inserted, 1);
  const bundle = (await app.inject({ url: `/api/matches/${match.id}` })).json();
  assert.equal(bundle.events[0].status, 'suggested');
  assert.ok(bundle.events[0].player_id);
  assert.equal(bundle.jobs[0].status, 'done');
  await app.close();
});

test('password protection and share links', async () => {
  const app = await setup({ APP_PASSWORD: 'secret', SESSION_SECRET: 's' });
  assert.equal((await app.inject({ url: '/api/teams' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'x' } })).statusCode, 401);
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'secret' } });
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const m = (await app.inject({ method: 'POST', url: '/api/matches', headers: { cookie }, payload: { label: 'm' } })).json();
  await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, headers: { cookie }, payload: { action: 'ace' } });
  const { share_token } = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/share`, headers: { cookie }, payload: {} })).json();
  const shared = (await app.inject({ url: `/api/share/${share_token}` })).json();
  assert.equal(shared.events.length, 1);
  await app.close();
});
