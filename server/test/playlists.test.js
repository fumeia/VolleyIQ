import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/index.js';

test('playlists: tags from several matches in order, on the public link, cleaned when tags go', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-pl-'));
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') });
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Herren 2' } })).json();
  const other = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Other' } })).json();
  const m1 = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'a', team_id: team.id, played_on: '2026-10-01' } })).json();
  const m2 = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'b', team_id: team.id, played_on: '2026-10-08' } })).json();
  const mo = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'c', team_id: other.id } })).json();
  const tag = async (m, t) => (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action: 'attack_blocked', t } })).json();
  const a = await tag(m2, 50), b = await tag(m1, 90), c = await tag(m1, 30), x = await tag(mo, 10);

  assert.equal((await app.inject({ method: 'POST', url: `/api/teams/${team.id}/playlists`, payload: { title: ' ' } })).statusCode, 400);
  const pl = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/playlists`, payload: { title: 'Our blocked attacks' } })).json();
  const added = (await app.inject({ method: 'POST', url: `/api/playlists/${pl.id}/items`, payload: { event_ids: [a.id, b.id, c.id, x.id] } })).json();
  assert.deepEqual(added.items, [c.id, b.id, a.id], 'match by match, in video order; another team\'s tag is left out');
  await app.inject({ method: 'POST', url: `/api/playlists/${pl.id}/items`, payload: { event_ids: [a.id] } });
  assert.equal((await app.inject({ url: `/api/teams/${team.id}/playlists` })).json()[0].items.length, 3, 'no doubles');

  const moved = (await app.inject({ method: 'PATCH', url: `/api/playlists/${pl.id}`, payload: { title: 'Blocked', order: [a.id, c.id, b.id] } })).json();
  assert.deepEqual([moved.title, moved.items], ['Blocked', [a.id, c.id, b.id]]);

  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;
  const shared = (await app.inject({ url: `/api/share/team/${token}` })).json();
  assert.deepEqual(shared.playlists.map((p) => [p.title, p.items]), [['Blocked', [a.id, c.id, b.id]]]);

  await app.inject({ method: 'DELETE', url: `/api/events/${c.id}` });
  assert.deepEqual((await app.inject({ url: `/api/teams/${team.id}/playlists` })).json()[0].items, [a.id, b.id], 'a deleted tag leaves the playlist');
  await app.inject({ method: 'DELETE', url: `/api/playlists/${pl.id}/items/${a.id}` });
  await app.inject({ method: 'DELETE', url: `/api/playlists/${pl.id}` });
  assert.deepEqual((await app.inject({ url: `/api/teams/${team.id}/playlists` })).json(), []);
  await app.close();
});

test('teammates make their own playlists on the public link: public or only for them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-pl2-'));
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') });
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Herren 2' } })).json();
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'a', team_id: team.id } })).json();
  const e1 = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action: 'kill', t: 10 } })).json();
  const e2 = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action: 'ace', t: 20 } })).json();
  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;
  const base = `/api/share/team/${token}/playlists`;

  assert.equal((await app.inject({ method: 'POST', url: base, payload: { title: 'Mine' } })).statusCode, 400, 'shirt number needed');
  const mine = (await app.inject({ method: 'POST', url: base, payload: { title: 'My kills', jersey: 7, public: false } })).json();
  assert.deepEqual([mine.owner_jersey, mine.is_public], [7, false]);
  const pub = (await app.inject({ method: 'POST', url: base, payload: { title: 'Best of', jersey: 7 } })).json();
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${mine.id}/items`, payload: { jersey: 7, event_ids: [e1.id, e2.id] } })).json().items.length, 2);
  await app.inject({ method: 'POST', url: `${base}/${pub.id}/items`, payload: { jersey: 7, event_ids: [e2.id] } });

  // Someone else (or nobody) sees the public one only, and cannot change it.
  const titles = async (q) => (await app.inject({ url: `${base}${q}` })).json().map((p) => p.title);
  assert.deepEqual(await titles(''), ['Best of']);
  assert.deepEqual(await titles('?jersey=12'), ['Best of']);
  assert.deepEqual(await titles('?jersey=7'), ['My kills', 'Best of']);
  assert.deepEqual((await app.inject({ url: `/api/share/team/${token}` })).json().playlists.map((p) => p.title), ['Best of']);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${pub.id}/items`, payload: { jersey: 12, event_ids: [e1.id] } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/${pub.id}`, payload: { jersey: 12 } })).statusCode, 403);

  // The owner makes it public, removes a clip; the coach sees everything with its owner.
  assert.equal((await app.inject({ method: 'PATCH', url: `${base}/${mine.id}`, payload: { jersey: 7, public: true } })).json().is_public, true);
  assert.deepEqual((await app.inject({ method: 'DELETE', url: `${base}/${mine.id}/items/${e1.id}`, payload: { jersey: 7 } })).json().items, [e2.id]);
  assert.deepEqual((await app.inject({ url: `/api/teams/${team.id}/playlists` })).json().map((p) => [p.title, p.owner_jersey]), [['My kills', 7], ['Best of', 7]]);
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/${mine.id}`, payload: { jersey: 7 } })).statusCode, 200);
  await app.close();
});

test('live score on the public page while tags come in', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-live-'));
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') });
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Herren 2' } })).json();
  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;
  assert.deepEqual((await app.inject({ url: `/api/share/team/${token}/live` })).json(), { live: null });
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'Heim', opponent: 'Volley Nord', team_id: team.id, mode: 'live' } })).json();
  const tag = (action, set_no) => app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action, set_no } });
  for (let i = 0; i < 25; i++) await tag('kill', 1);
  for (let i = 0; i < 20; i++) await tag('opp_point', 1);
  await tag('ace', 2); await tag('serve_error', 2); await tag('opp_error', 2); await tag('dig', 2);
  const live = (await app.inject({ url: `/api/share/team/${token}/live` })).json().live;
  assert.equal(live.match.opponent, 'Volley Nord');
  assert.deepEqual(live.sets.map((x) => [x.set, x.us, x.them, x.done]), [[1, 25, 20, true], [2, 2, 1, false]]);
  assert.deepEqual([live.won, live.lost], [1, 0]);
  await app.close();
});
