import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/index.js';

async function setup(extra = {}, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-'));
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none'), ...extra }, opts);
  app.dataDir = dir;
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
  const lineups = { 1: { order: [1, 2, 3, 4, 5, null], libero: 7, weServeFirst: true, subs: [{ t: 312.5, out: 4, in: 8 }] } };
  assert.deepEqual((await app.inject({ method: 'PATCH', url: `/api/matches/${match.id}`, payload: { lineups } })).json().lineups, lineups);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/matches/${match.id}`, payload: { lineups: { 1: { order: [1, 2] } } } })).statusCode, 400);
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
  // Rally numbers can be changed (join / split rallies in review).
  const dig = bundle.events.find((e) => e.action === 'dig');
  const moved = (await app.inject({ method: 'PATCH', url: `/api/events/${dig.id}`, payload: { rally: 42, poss: 3 } })).json();
  assert.deepEqual([moved.rally, moved.poss], [42, 3]);
  // A re-run does not suggest the saved serve at t=3 again, but brings back the others.
  assert.equal((await post([{ action: 'serve', t: 3.1 }, { action: 'dig', t: 9 }])).json().inserted, 1);
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
  assert.equal(season.team.show_tips, 0);
  await app.inject({ method: 'PATCH', url: `/api/teams/${team.id}`, headers: { cookie }, payload: { show_tips: true } });
  assert.equal((await app.inject({ url: `/api/share/team/${ts.share_token}` })).json().team.show_tips, 1);
  assert.equal(season.events.length, 1);
  // The public season page runs the full analysis: it needs where each ball was played from too.
  await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, headers: { cookie }, payload: { action: 'kill', fx: 1.5, fy: 8, x: 7, y: 15 } });
  const kill = (await app.inject({ url: `/api/share/team/${ts.share_token}` })).json().events.find((e) => e.action === 'kill');
  assert.deepEqual([kill.fx, kill.fy, kill.x, kill.y], [1.5, 8, 7, 15]);
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

test('analyst effort: active time, corrected and removed auto suggestions', async () => {
  const app = await setup();
  const match = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'm' } })).json();
  await app.inject({ method: 'POST', url: `/api/matches/${match.id}/suggestions`, payload: { events: [
    { action: 'serve', t: 1 }, { action: 'dig', t: 5 }, { action: 'set', t: 6 }, { action: 'attack', t: 7 },
  ] } });
  const evs = (await app.inject({ url: `/api/matches/${match.id}` })).json().events;
  await app.inject({ method: 'PATCH', url: `/api/events/${evs[0].id}`, payload: { status: 'confirmed' } });
  await app.inject({ method: 'PATCH', url: `/api/events/${evs[1].id}`, payload: { status: 'confirmed', action: 'receive', value: 2 } });
  await app.inject({ method: 'DELETE', url: `/api/events/${evs[2].id}` });
  await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events/bulk`, payload: { op: 'delete', ids: [evs[3].id] } });
  const manual = (await app.inject({ method: 'POST', url: `/api/matches/${match.id}/events`, payload: { action: 'kill', t: 8 } })).json();
  await app.inject({ method: 'DELETE', url: `/api/events/${manual.id}` }); // own tag: not a false detection
  assert.equal((await app.inject({ method: 'POST', url: `/api/matches/${match.id}/work`, payload: { sec: 30 } })).json().work_sec, 30);
  assert.equal((await app.inject({ method: 'POST', url: `/api/matches/${match.id}/work`, payload: { sec: 5000 } })).statusCode, 400);
  const m = (await app.inject({ url: '/api/matches' })).json()[0];
  assert.deepEqual([m.work_sec, m.edited_count, m.removed_count, m.confirmed_count, m.auto_confirmed_count], [30, 1, 2, 2, 2]);
  await app.close();
});

test('AI insights: disabled by default, works with an injected generator', async () => {
  const off = await setup();
  assert.equal((await off.inject({ url: '/api/insights/enabled' })).json().enabled, false);
  assert.equal((await off.inject({ method: 'POST', url: '/api/insights/summary', payload: { stats: {} } })).statusCode, 503);
  await off.close();

  const gen = { enabled: true, model: 't', generate: async (stats, lang) => [`${lang}: eff ${stats.attackEff}`, 'work on reception'] };
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'viq-')), WEB_DIST: '/none' }, { insights: gen });
  assert.equal((await app.inject({ url: '/api/insights/enabled' })).json().enabled, true);
  assert.equal((await app.inject({ method: 'POST', url: '/api/insights/summary', payload: {} })).statusCode, 400);
  const res = (await app.inject({ method: 'POST', url: '/api/insights/summary', payload: { stats: { attackEff: 0.12 }, lang: 'de' } })).json();
  assert.equal(res.bullets[0], 'de: eff 0.12');
  assert.equal(res.bullets.length, 2);
  await app.close();
});

test('match sheet scan: disabled by default, works with a scanner, validates input', async () => {
  const off = await setup();
  assert.equal((await off.inject({ url: '/api/matchsheet/enabled' })).json().enabled, false);
  assert.equal((await off.inject({ method: 'POST', url: '/api/matchsheet/scan', payload: { images: [{ media_type: 'image/png', data: 'x' }] } })).statusCode, 503);
  await off.close();

  const fake = { enabled: true, model: 'test', scan: async (images) => ({
    teams: { A: 'Home VC', B: 'Away VC' }, date: '2026-01-10', league: '3.L', matchNo: '100001',
    winner: 'B', setsWon: { A: 1, B: 3 }, sets: [{ a: 22, b: 25 }],
    rosters: { A: [{ number: 5, name: 'A.Player', captain: true, libero: false }], B: [] }, confidence: 'medium', _n: images.length }) };
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'viq-')), WEB_DIST: '/none' }, { vision: fake });
  assert.equal((await app.inject({ url: '/api/matchsheet/enabled' })).json().enabled, true);
  assert.equal((await app.inject({ method: 'POST', url: '/api/matchsheet/scan', payload: { images: [] } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/matchsheet/scan', payload: { images: [{ media_type: 'application/pdf', data: 'x' }] } })).statusCode, 400);
  const res = (await app.inject({ method: 'POST', url: '/api/matchsheet/scan', payload: { images: [{ media_type: 'image/jpeg', data: 'abc' }] } })).json();
  assert.equal(res.data.teams.B, 'Away VC');
  assert.equal(res.data.setsWon.B, 3);
  assert.equal(res.data.rosters.A[0].captain, true);
  await app.close();
});

test('clear unreviewed suggestions keeps confirmed touches', async () => {
  const app = await setup();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'c' } })).json();
  await app.inject({ method: 'POST', url: `/api/matches/${m.id}/suggestions`, payload: { events: [
    { action: 'serve', t: 1 }, { action: 'dig', t: 2 }, { action: 'set', t: 3 },
  ] } });
  const evs = (await app.inject({ url: `/api/matches/${m.id}` })).json().events;
  await app.inject({ method: 'PATCH', url: `/api/events/${evs[0].id}`, payload: { status: 'confirmed' } });
  const res = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/suggestions/clear` })).json();
  assert.equal(res.deleted, 2);
  const left = (await app.inject({ url: `/api/matches/${m.id}` })).json().events;
  assert.deepEqual(left.map((e) => [e.action, e.status]), [['serve', 'confirmed']]);
  await app.close();
});

test('match sheet flow is stored cleaned with the match', async () => {
  const app = await setup();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'm' } })).json();
  const sheet = { ourTeam: 'A', sets: [{ a: 25, b: 20 }], flow: [{ set: 1, firstServe: 'A', A: { start: [9, 42, 12, 7, 2, 5], subs: [{ col: 5, in: 8, own: 4, opp: 9 }], rounds: [[0, 1, 2, 'x', 'junk', 99]], timeouts: [] }, B: { start: [], subs: [], rounds: [], timeouts: [] }, evil: '<script>' }] };
  const r = await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { sheet } });
  assert.equal(r.statusCode, 200);
  const got = r.json().sheet;
  assert.deepEqual(got.flow[0].A.rounds[0], [0, 1, 2, 'X', null, null]);
  assert.equal(got.flow[0].evil, undefined);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { sheet: { ourTeam: 'C' } } })).statusCode, 400);
  await app.close();
});

test('saved versions: restore brings the tags back and keeps the state before it', async () => {
  const app = await setup();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'm' } })).json();
  const add = (action) => app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action, t: 1, set_no: 1 } });
  await add('ace'); await add('kill');
  const list = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/versions`, payload: { label: 'Original' } })).json();
  assert.equal(list[0].label, 'Original');
  assert.equal(list[0].event_count, 2);
  // Changes after saving: one more tag, one removed.
  await add('serve_error');
  const evs = (await app.inject({ url: `/api/matches/${m.id}` })).json().events;
  await app.inject({ method: 'DELETE', url: `/api/events/${evs.find((e) => e.action === 'ace').id}` });
  const back = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/versions/${list[0].id}/restore` })).json();
  assert.deepEqual(back.events.map((e) => e.action).sort(), ['ace', 'kill']);
  assert.equal(back.versions[0].label, 'Before restoring "Original"');
  assert.equal(back.versions[0].event_count, 2);
  assert.equal(back.versions[0].auto, 1);
  await app.close();
});

test('app updates: newest stable and test APK from the GitHub releases, streamed through', async () => {
  const { makeUpdates } = await import('../src/updates.js');
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    if (url.endsWith('/releases/latest')) return { ok: true, status: 200, json: async () => ({ tag_name: 'v1.2.0', name: 'VolleyIQ v1.2.0', body: 'notes', published_at: 'x', assets: [{ id: 5, name: 'VolleyIQ-1.2.0.apk', size: 9 }, { id: 6, name: 'VolleyIQ.apk', size: 9 }] }) };
    if (url.endsWith('/tags/android-latest')) return { ok: true, status: 200, json: async () => ({ tag_name: 'android-latest', assets: [{ id: 7, name: 'VolleyIQ-1.2.1-dev.90.apk', size: 9 }, { id: 8, name: 'VolleyIQ-1.2.1-dev.91.apk', size: 9 }, { id: 9, name: 'VolleyIQ.apk', size: 9 }] }) };
    if (url.includes('/actions/workflows/android.yml/runs')) return { ok: true, status: 200, json: async () => ({ workflow_runs: [{ status: 'in_progress', display_title: 'Voice tagging', run_started_at: '2026-11-02T10:00:00Z', html_url: 'u' }, { status: 'completed' }] }) };
    if (url.endsWith('/assets/6')) return { ok: true, status: 200, headers: new Headers({ 'content-length': '3' }), body: new Blob(['apk']).stream() };
    return { ok: false, status: 404 };
  };
  const updates = makeUpdates({ UPDATE_REPO: 'me/repo', UPDATE_GITHUB_TOKEN: 't' }, fakeFetch);
  const app = await setup({}, { updates });
  assert.match((await app.inject({ url: '/api/health' })).json().version, /^\d+\.\d+\.\d+/);
  const stable = (await app.inject({ url: '/api/app/update' })).json();
  assert.deepEqual([stable.latest.version, stable.latest.assetId, stable.latest.notes], ['1.2.0', 6, 'notes']);
  // A build still running on GitHub: a newer version is on its way.
  assert.deepEqual(stable.building, { title: 'Voice tagging', started: '2026-11-02T10:00:00Z', url: 'u' });
  const test = (await app.inject({ url: '/api/app/update?channel=test' })).json();
  assert.deepEqual([test.latest.version, test.latest.assetId], ['1.2.1-dev.91', 8]);
  const apk = await app.inject({ url: '/api/app/apk/6' });
  assert.equal(apk.statusCode, 200);
  assert.equal(apk.body, 'apk');
  assert.equal(calls[0].auth, 'Bearer t');
  assert.equal((await app.inject({ url: '/api/app/apk/abc' })).statusCode, 400);
  await app.close();
});

test('migration v13: a 0 pass that ended the rally gets the opponent ace; a rescued one does not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-'));
  const env = { NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') };
  let app = await buildApp(env);
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'm' } })).json();
  const add = (action, t, value = null) => app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action, t, value, set_no: 1 } });
  await add('receive', 1, 0);      // aced: next tag starts a new rally
  await add('receive', 5, 2);
  await add('receive', 9, 0);      // rescued: the rally goes on
  await add('dig', 10);
  await add('kill', 11);
  await add('receive', 20, 0);     // last tag of the set: aced
  await app.close();
  const { default: Database } = await import('better-sqlite3');
  const raw = new Database(path.join(dir, 'volleyiq.db'));
  raw.pragma('user_version = 12');
  raw.close();
  app = await buildApp(env);
  const evs = (await app.inject({ url: `/api/matches/${m.id}` })).json().events;
  assert.deepEqual(evs.filter((e) => e.action === 'opp_point').map((e) => [e.t, e.value]), [[1.05, 3], [20.05, 3]]);
  const versions = (await app.inject({ url: `/api/matches/${m.id}/versions` })).json();
  assert.equal(versions[0].label, 'Before the 0-pass scoring change');
  await app.close();
});

test('edit suggestions from the public link: sent, listed, accepted or rejected', async () => {
  const app = await setup();
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'U18' } })).json();
  const a = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/players`, payload: { name: 'Ana', number: 7, role: 'OH' } })).json();
  const b = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/players`, payload: { name: 'Bo', number: 9, role: 'OH' } })).json();
  const other = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'X' } })).json();
  const stranger = (await app.inject({ method: 'POST', url: `/api/teams/${other.id}/players`, payload: { name: 'Z', number: 1 } })).json();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'vs Y', team_id: team.id, video_type: 'youtube', video_ref: 'abcdefghijk' } })).json();
  const e = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action: 'attack', player_id: a.id, t: 30, set_no: 1 } })).json();
  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;

  const shared = (await app.inject({ url: `/api/share/team/${token}` })).json();
  assert.deepEqual(shared.matches[0].video, { type: 'youtube', id: 'abcdefghijk' });

  const send = (body) => app.inject({ method: 'POST', url: `/api/share/team/${token}/edits`, payload: body });
  assert.equal((await send({ event_id: e.id, changes: { action: 'kill' }, note: 'it landed in' })).statusCode, 400, 'shirt number required');
  assert.equal((await send({ event_id: e.id, changes: { action: 'kill' }, note: 'it landed in', jersey: 9 })).statusCode, 200);
  assert.equal((await send({ event_id: e.id, changes: { action: 'nope' } })).statusCode, 400);
  assert.equal((await send({ event_id: e.id, changes: { player_id: stranger.id } })).statusCode, 400);
  assert.equal((await send({ event_id: e.id, changes: { action: 'attack' }, jersey: 9 })).statusCode, 400, 'nothing changed');
  assert.equal((await app.inject({ method: 'POST', url: '/api/share/team/wrong/edits', payload: { event_id: e.id, changes: { action: 'kill' } } })).statusCode, 404);
  assert.equal((await send({ event_id: e.id, changes: { player_id: b.id, x: 3, y: 15 }, jersey: 4 })).statusCode, 200);

  assert.equal((await app.inject({ url: '/api/matches' })).json()[0].open_edits, 2);
  const list = (await app.inject({ url: `/api/edits?match_id=${m.id}` })).json();
  assert.equal(list.length, 2);
  const [move, kill] = list;
  assert.deepEqual(kill.changes, { action: 'kill' });
  assert.equal(kill.sender_jersey, 9);
  assert.equal(kill.original.action, 'attack');
  assert.equal(kill.event.action, 'attack');

  const acc = (await app.inject({ method: 'POST', url: `/api/edits/${move.id}/accept` })).json();
  assert.equal(acc.event.player_id, b.id);
  assert.equal(acc.event.jersey, 9);
  assert.equal(acc.event.x, 3);
  assert.equal(acc.event.action, 'attack');
  assert.equal((await app.inject({ method: 'POST', url: `/api/edits/${kill.id}/reject` })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/matches/${m.id}` })).json().events[0].action, 'attack');
  assert.equal((await app.inject({ url: '/api/edits' })).json().length, 0);
  assert.equal((await app.inject({ url: '/api/edits?status=accepted' })).json().length, 1);
  await app.close();
});

test('suggesting a touch that is not tagged (e.g. a block without a touch), accepted as a new tag', async () => {
  const app = await setup();
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'U18' } })).json();
  const mb = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/players`, payload: { name: 'Max', number: 5, role: 'MB' } })).json();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'vs Y', team_id: team.id } })).json();
  await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action: 'dig', t: 100, set_no: 2 } });
  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;
  const send = (body) => app.inject({ method: 'POST', url: `/api/share/team/${token}/edits`, payload: { kind: 'add', jersey: 5, ...body } });
  assert.equal((await send({ match_id: m.id, changes: { action: 'block_miss', player_id: mb.id } })).statusCode, 400, 'needs a time');
  assert.equal((await send({ match_id: 999, t: 99, changes: { action: 'block_miss' } })).statusCode, 404);
  const ok = await send({ match_id: m.id, t: 99.4, changes: { action: 'block_miss', player_id: mb.id, fx: 3, fy: 16, x: 7, y: 4 } });
  assert.equal(ok.statusCode, 200);
  const [s] = (await app.inject({ url: '/api/edits' })).json();
  assert.equal(s.kind, 'add');
  assert.equal(s.event, null);
  assert.equal(s.changes.set_no, 2, 'set from the nearest tag');
  const acc = (await app.inject({ method: 'POST', url: `/api/edits/${s.id}/accept` })).json();
  assert.equal(acc.event.action, 'block_miss');
  assert.equal(acc.event.jersey, 5);
  assert.equal(acc.event.t, 99.4);
  assert.equal(acc.event.status, 'confirmed');
  assert.equal((await app.inject({ url: `/api/matches/${m.id}` })).json().events.length, 2);
  await app.close();
});

test('each detection run is kept as it came, with the touches already saved, for measuring', async () => {
  const app = await setup();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'm' } })).json();
  await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action: 'serve', t: 10 } });
  const run = [{ t: 10.1, action: 'serve', rally: 1, poss: 0 }, { t: 11, action: 'receive', rally: 1, poss: 1, jersey: 7, confidence: 0.4 }, { action: 'dig' }];
  const r = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/suggestions`, payload: { events: run, params: { sensitivity: 1.2 } } })).json();
  assert.equal(r.inserted, 2, 'the serve is already saved (the dig without a time is kept as a suggestion, not in the run)');
  const runs = (await app.inject({ url: `/api/matches/${m.id}/runs` })).json();
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].params, { sensitivity: 1.2 });
  assert.deepEqual(runs[0].events.map((e) => [e.t, e.action, e.jersey]), [[10.1, 'serve', null], [11, 'receive', 7]]);
  await app.close();
});

test('match video in the bucket: multipart upload signed by the server, links for the team, delete', async () => {
  const calls = [];
  const fake = async (url, o) => {
    calls.push({ url, method: o.method, body: o.body, auth: o.headers.Authorization });
    const u = new URL(url);
    if (o.method === 'POST' && u.searchParams.has('uploads')) return { ok: true, text: async () => '<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>' };
    return { ok: true, text: async () => '' };
  };
  const storage = (await import('../src/s3.js')).s3Config({ S3_ENDPOINT: 'https://hel1.your-objectstorage.com', S3_BUCKET: 'vids', S3_ACCESS_KEY: 'AK', S3_SECRET_KEY: 'SK' });
  const app = await setup({}, { storage, storageFetch: fake });
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'U18' } })).json();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'm', team_id: team.id } })).json();
  assert.equal((await app.inject({ url: '/api/video/enabled' })).json().enabled, true);

  const up = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/video/upload`, payload: { size: 40 * 1024 * 1024, name: 'match.MP4' } })).json();
  assert.equal(up.uploadId, 'up-1');
  assert.equal(up.parts, 3);
  assert.match(up.key, new RegExp(`^matches/${m.id}/.+\\.mp4$`));
  assert.match(calls[0].url, /^https:\/\/vids\.hel1\.your-objectstorage\.com\/matches\/.+\?uploads=$/);
  assert.match(calls[0].auth, /Credential=AK\/\d{8}\/hel1\/s3\/aws4_request/);

  const parts = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/video/parts`, payload: { key: up.key, uploadId: up.uploadId, parts: [1, 2, 3] } })).json();
  assert.match(parts.urls['2'], /X-Amz-Algorithm=AWS4-HMAC-SHA256.*&partNumber=2&uploadId=up-1&X-Amz-Signature=/);
  assert.equal((await app.inject({ method: 'POST', url: `/api/matches/${m.id}/video/parts`, payload: { key: 'matches/999/x.mp4', uploadId: 'up-1', parts: [1] } })).statusCode, 400, 'only keys of this match');

  const done = await app.inject({ method: 'POST', url: `/api/matches/${m.id}/video/complete`, payload: { key: up.key, uploadId: up.uploadId, size: 40 * 1024 * 1024, parts: [{ n: 2, etag: '"b"' }, { n: 1, etag: '"a"' }, { n: 3, etag: '"c"' }] } });
  assert.equal(done.statusCode, 200);
  assert.match(calls.at(-1).body, /<Part><PartNumber>1<\/PartNumber><ETag>"a"<\/ETag><\/Part><Part><PartNumber>2/);

  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;
  assert.deepEqual((await app.inject({ url: `/api/share/team/${token}` })).json().matches[0].video, { type: 'hosted' });
  const link = (await app.inject({ url: `/api/share/team/${token}/video/${m.id}` })).json();
  assert.match(link.url, /X-Amz-Expires=21600/);
  assert.equal((await app.inject({ url: `/api/share/team/wrong/video/${m.id}` })).statusCode, 404);

  const db = (await import('../src/db.js')).openDb(app.dataDir);
  // The upload queued the conversion; once the converter recorded the sizes, the links carry them.
  assert.equal((await app.inject({ url: `/api/matches/${m.id}/video/status` })).json().job.state, 'queued');
  assert.equal((await app.inject({ method: 'POST', url: `/api/matches/${m.id}/video/convert` })).statusCode, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_jobs WHERE match_id = ?').get(m.id).n, 1, 'asking again replaces the waiting job');
  db.prepare('UPDATE matches SET video_variants = ? WHERE id = ?').run(JSON.stringify({ 720: { key: 'x-720.mp4' }, 480: { key: 'x-480.mp4' } }), m.id);
  const sized = (await app.inject({ url: `/api/share/team/${token}/video/${m.id}` })).json();
  assert.deepEqual(Object.keys(sized.variants).sort(), ['480', '720']);
  assert.match(sized.variants['480'], /x-480\.mp4\?X-Amz/);

  assert.equal((await app.inject({ method: 'DELETE', url: `/api/matches/${m.id}/video` })).statusCode, 200);
  assert.ok(['abc', 'x-720.mp4', 'x-480.mp4'].slice(1).every((k) => calls.some((c) => c.method === 'DELETE' && c.url.includes(k))), 'the smaller sizes are deleted too');
  assert.equal((await app.inject({ url: `/api/share/team/${token}/video/${m.id}` })).statusCode, 404);
  await app.close();
});

test('practice match: sides per set, the side on each tag, the live score per side', async () => {
  const app = await setup();
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'P' } })).json();
  const a = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/players`, payload: { name: 'A', number: 1 } })).json();
  const b = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/players`, payload: { name: 'B', number: 2 } })).json();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'Practice', team_id: team.id, mode: 'live' } })).json();
  const practice = { names: { a: 'Blue', b: 'White' }, sets: { 1: { a: [a.id], b: [b.id] } } };
  assert.deepEqual((await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { practice } })).json().practice, practice);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { practice: { names: { a: '' }, sets: {} } } })).statusCode, 400);
  // The second side's line-ups survive saving the sides without them; null removes them.
  const lineupsB = { 1: { order: [b.id, null, null, null, null, null], libero: null, weServeFirst: false } };
  await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { practice: { ...practice, lineupsB } } });
  const kept = (await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { practice } })).json().practice;
  assert.deepEqual(kept.lineupsB, lineupsB);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { practice: { ...practice, lineupsB: null } } })).json().practice.lineupsB, undefined);
  await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { practice } });
  const post = (payload) => app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { set_no: 1, ...payload } });
  assert.equal((await post({ action: 'kill', player_id: b.id, side: 'b' })).json().side, 'b');
  await post({ action: 'kill', player_id: a.id, side: 'a' });
  await post({ action: 'attack_error', player_id: b.id, side: 'b' });
  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;
  const live = (await app.inject({ url: `/api/share/team/${token}/live` })).json().live;
  // Blue: its kill and White's error; White: its kill.
  assert.deepEqual([live.sets[0].us, live.sets[0].them, live.match.ourName, live.match.opponent], [2, 1, 'Blue', 'White']);
  const shared = (await app.inject({ url: `/api/share/team/${token}` })).json();
  assert.deepEqual(shared.events.map((e) => e.side), ['b', 'a', 'b']);
  assert.equal(shared.matches[0].practice.names.b, 'White');
  await app.close();
});

test('a blocked attack answered by the block point of the other side is one point; fully tagged matches get no suggestions', async () => {
  const app = await setup();
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Blocks' } })).json();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'Practice', team_id: team.id, mode: 'live' } })).json();
  await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { practice: { names: { a: 'Near', b: 'Far' }, sets: {} } } });
  const post = (payload) => app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { set_no: 1, ...payload } });
  await post({ action: 'attack_blocked', side: 'a', t: 10 });
  await post({ action: 'block_point', side: 'b', t: 10.5 });
  await post({ action: 'kill', side: 'a', t: 30 });
  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;
  const live = (await app.inject({ url: `/api/share/team/${token}/live` })).json().live;
  // Near: its kill. Far: the block point only (not the blocked attack too).
  assert.deepEqual([live.sets[0].us, live.sets[0].them], [1, 1]);
  // Marked fully tagged: a detection run adds nothing.
  const final = { at: '2026-11-07T12:00:00Z', rules: 2 };
  assert.deepEqual((await app.inject({ method: 'PATCH', url: `/api/matches/${m.id}`, payload: { final } })).json().final, final);
  const r = await app.inject({ method: 'POST', url: `/api/matches/${m.id}/suggestions`, payload: { events: [{ action: 'attack', t: 50 }] } });
  assert.equal(r.json().inserted, 0);
  await app.close();
});
