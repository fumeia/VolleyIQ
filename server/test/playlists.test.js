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
