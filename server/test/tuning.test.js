import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/index.js';
import { evaluate, matchData, tune } from '../src/tuning.js';

// A made-up match: rallies every 30 s with 5 touches; touches sound at score 6.5 (below the
// default 8), crowd noise between rallies scores up to 7 but lasts long (sustain 0.9).
function fake(rallies = 40) {
  const events = [], peaks = [];
  for (let r = 0; r < rallies; r++) {
    const t0 = 10 + r * 30;
    for (let k = 0; k < 5; k++) { events.push({ t: t0 + k * 1.5, action: k === 0 ? 'serve' : 'dig', value: null, status: 'confirmed' }); peaks.push([t0 + k * 1.5 + 0.1, 6.5, 0.3]); }
    events.push({ t: t0 + 7, action: 'kill', value: null, status: 'confirmed' });
    peaks.push([t0 + 7.05, 9, 0.3]);
    peaks.push([t0 + 14, 7, 0.9], [t0 + 16, 5, 0.9], [t0 + 17, 4.2, 0.2]);
  }
  return { events, peaks: peaks.sort((a, b) => a[0] - b[0]) };
}

test('tuning finds thresholds that hear the touches and not the crowd', () => {
  const { events, peaks } = fake();
  const m = matchData(events, peaks);
  assert.equal(m.touches.length, 240);
  assert.equal(m.dead.length, 39);
  const base = evaluate([m], 8, 0.6);
  assert.equal(base.found, 40, 'the defaults only hear the loud kills');
  const r = tune([m]);
  assert.equal(r.ready, true);
  assert.equal(r.best.found, 240);
  assert.equal(r.best.noise, 0, 'the long crowd sounds and the faint ones stay out');
  assert.ok(r.best.threshold > 4.2 && r.best.threshold <= 6.5 && r.best.sustainMax < 0.9, JSON.stringify(r.best));
  assert.equal(tune([matchData(events.slice(0, 50), peaks)]).ready, false, 'too few touches to learn from');
});

test('the app gets learned thresholds once enough was tagged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-tune-'));
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') });
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'test' } })).json();
  assert.deepEqual((await app.inject({ url: '/api/detector' })).json().use, { threshold: 8, sustainMax: 0.6 });
  const { events, peaks } = fake();
  for (const e of events) await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action: e.action, t: e.t } });
  const run = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/suggestions`, payload: { events: [{ t: 10.1, action: 'serve' }], params: { threshold: 8 }, candidates: peaks } }));
  assert.equal(run.statusCode, 200, run.body);
  const d = (await app.inject({ url: '/api/detector' })).json();
  assert.equal(d.ready, true);
  assert.notDeepEqual(d.use, { threshold: 8, sustainMax: 0.6 });
  assert.ok(d.best.recall > d.baseline.recall);
  await app.inject({ method: 'PUT', url: '/api/detector', payload: { off: true } });
  assert.deepEqual((await app.inject({ url: '/api/detector' })).json().use, { threshold: 8, sustainMax: 0.6 }, 'switched off: the defaults');
  await app.close();
});
