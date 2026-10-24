import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/index.js';

async function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-'));
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none'), ...extra });
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

  const pt = (await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events`, payload: { action: 'receive', x: 6.1, y: 7.9, value: 3 } })).json();
  assert.equal(pt.x, 6.1);
  assert.equal((await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events`, payload: { action: 'kill', x: 4 } })).statusCode, 400);

  const badRes = await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events`, payload: { action: 'nope' } });
  assert.equal(badRes.statusCode, 400);

  const patched = (await app.inject({ method: 'PATCH', url: `/api/events/${e1.id}`, payload: { action: 'attack_error', zone: null } })).json();
  assert.equal(patched.action, 'attack_error');
  assert.equal(patched.zone, null);

  const cal = { corners: [[0.1, 0.9], [0.9, 0.9], [0.7, 0.3], [0.3, 0.3]], ourHalf: 'near' };
  assert.deepEqual((await app.inject({ method: 'PATCH', url: `/api/matches/${match.id}`, payload: { calibration: cal } })).json().calibration, cal);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/matches/${match.id}`, payload: { calibration: { corners: [[0, 0]] } } })).statusCode, 400);
  const landmarks = { points: [['netL', 0, 9], ['netR', 9, 9], ['attNL', 0, 6], ['attNR', 9, 6]].map(([id, x, y], i) => ({ id, u: 0.2 + i * 0.1, v: 0.5, x, y, extra: 1 })), ourHalf: 'far' };
  const saved = (await app.inject({ method: 'PATCH', url: `/api/matches/${match.id}`, payload: { calibration: landmarks } })).json().calibration;
  assert.equal(saved.points.length, 4);
  assert.equal(saved.points[0].extra, undefined);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/matches/${match.id}`, payload: { calibration: { points: landmarks.points.slice(0, 3), ourHalf: 'near' } } })).statusCode, 400);
  // One side switch per set, the second with a new court marking.
  const sets = { points: saved.points, ourHalf: 'far', switches: [{ t: 610.5, ourHalf: 'far' }, { t: 1300, ourHalf: 'near', points: saved.points }] };
  assert.deepEqual((await app.inject({ method: 'PATCH', url: `/api/matches/${match.id}`, payload: { calibration: sets } })).json().calibration, sets);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/matches/${match.id}`, payload: { calibration: { ...landmarks, switches: [{ t: -1, ourHalf: 'far' }] } } })).statusCode, 400);
  await app.inject({ method: 'PATCH', url: `/api/matches/${match.id}`, payload: { calibration: cal } });

  const bundle = (await app.inject({ url: `/api/matches/${match.id}` })).json();
  assert.deepEqual(bundle.match.calibration, cal);
  assert.equal(bundle.events.length, 2);
  assert.equal(bundle.players.length, 1);
  await app.close();
});

test('app suggestions replace earlier unconfirmed suggestions only', async () => {
  const app = await setup();
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'A' } })).json();
  await app.inject({ method: 'POST', url: `/api/teams/${team.id}/players`, payload: { name: 'B', number: 3 } });
  const match = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'm', team_id: team.id } })).json();
  const post = (events) => app.inject({ method: 'POST', url: `/api/matches/${match.id}/suggestions`, payload: { events } });

  assert.equal((await post([{ action: 'serve', t: 3, jersey: 3, confidence: 0.6 }, { action: 'bogus', t: 4 }])).json().inserted, 1);
  let bundle = (await app.inject({ url: `/api/matches/${match.id}` })).json();
  assert.equal(bundle.events[0].status, 'suggested');
  assert.equal(bundle.events[0].source, 'auto');
  assert.ok(bundle.events[0].player_id, 'jersey resolved to roster player');

  await app.inject({ method: 'PATCH', url: `/api/events/${bundle.events[0].id}`, payload: { status: 'confirmed' } });
  // Two court spots: played from (fx, fy) and went to (x, y).
  const two = (await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events`, payload: { action: 'attack', fx: 7.5, fy: 7, x: 1.2, y: 16 } })).json();
  assert.deepEqual([two.fx, two.fy, two.x, two.y], [7.5, 7, 1.2, 16]);
  assert.equal((await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events`, payload: { action: 'attack', fx: 7.5 } })).statusCode, 400);
  await app.inject({ method: 'DELETE', url: `/api/events/${two.id}` });
  await post([{ action: 'dig', t: 9, hint: 'gap' }, { action: 'set', t: 10, hint: 'bogus' }]);
  bundle = (await app.inject({ url: `/api/matches/${match.id}` })).json();
  assert.deepEqual(bundle.events.map((e) => [e.action, e.status, e.hint]), [['serve', 'confirmed', null], ['dig', 'suggested', 'gap'], ['set', 'suggested', null]]);
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

  const team = (await app.inject({ method: 'POST', url: '/api/teams', headers: { cookie }, payload: { name: 'T' } })).json();
  await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, headers: { cookie }, payload: { team_id: team.id } });
  const ts = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, headers: { cookie }, payload: {} })).json();
  const season = (await app.inject({ url: `/api/share/team/${ts.share_token}` })).json();
  assert.equal(season.team.name, 'T');
  assert.equal(season.team.share_token, undefined);
  assert.equal(season.events.length, 1);
  await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, headers: { cookie }, payload: { revoke: true } });
  assert.equal((await app.inject({ url: `/api/share/team/${ts.share_token}` })).statusCode, 404);

  // The Android app uses the session as a bearer token from its own origin.
  const { token } = login.json();
  const viaBearer = await app.inject({ url: '/api/teams', headers: { authorization: `Bearer ${token}` } });
  assert.equal(viaBearer.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/teams', headers: { authorization: 'Bearer junk.junk' } })).statusCode, 401);
  const pre = await app.inject({ method: 'OPTIONS', url: '/api/teams', headers: { origin: 'https://localhost' } });
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers['access-control-allow-origin'], 'https://localhost');
  const evil = await app.inject({ method: 'OPTIONS', url: '/api/teams', headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers['access-control-allow-origin'], undefined);
  await app.close();
});
