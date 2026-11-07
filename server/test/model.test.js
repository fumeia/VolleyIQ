import { test } from 'node:test';
import assert from 'node:assert/strict';
import { features, labelMatch, trainModel, predict, N_FEATURES } from '../src/model.js';

// A made-up match: rallies of 5 touches 1 s apart (sharp, fast-rising sounds) and loud but dull
// noise between rallies (claps, shouts). Tags sit 0.8 s early, like taps with a reaction-time lead.
function syntheticMatch(seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const peaks = [], events = [];
  let t = 10;
  for (let r = 0; r < 60; r++) {
    for (let k = 0; k < 5; k++) {
      const tt = t + k * (0.9 + 0.2 * rnd());
      peaks.push([tt, 6 + 6 * rnd(), 0.2 + 0.2 * rnd(), 5, 4 + 2 * rnd(), 3 + rnd(), 0.1, 2, 0.3, 0.2]);
      events.push({ t: tt - 0.8, action: k === 4 ? 'kill' : 'attack', value: null, status: 'confirmed' });
    }
    // Dead time: noise as loud as the touches, but slow to rise, wide and fading slowly.
    const end = t + 5;
    for (let k = 0; k < 4; k++) peaks.push([end + 5 + k * 1.5 + rnd(), 6 + 6 * rnd(), 0.3 + 0.2 * rnd(), 5, 1.1 + 0.3 * rnd(), 12 + 4 * rnd(), 0.1, 2, 0.9, 0.8]);
    t = end + 30;
  }
  peaks.sort((a, b) => a[0] - b[0]);
  return { peaks, events };
}

test('sound model: features, labels from shifted tags, trained model beats the threshold rule', () => {
  const { peaks, events } = syntheticMatch();
  const x = features(peaks);
  assert.equal(x[0].length, N_FEATURES);
  const m = labelMatch(events, peaks);
  // The tags' delay is found: 0.8 s.
  assert.ok(Math.abs(m.offset - 0.8) < 0.15, `offset ${m.offset}`);
  assert.equal(m.labels.filter((l) => l === 1).length, 300);
  assert.ok(m.labels.filter((l) => l === 0).length >= 200);
  const r = trainModel([m]);
  assert.equal(r.ready, true);
  assert.ok(r.cv.recall > 0.95, `recall ${r.cv.recall}`);
  assert.ok(r.cv.noisePerMin < r.rule.noisePerMin, `noise ${r.cv.noisePerMin} vs ${r.rule.noisePerMin}`);
  assert.equal(r.better, true);
  // The model as the app gets it: a touch scores high, a dull noise low.
  const touch = x[peaks.findIndex((p) => p[5] < 5)];
  const noise = x[peaks.findIndex((p) => p[5] > 10)];
  assert.ok(predict(r.model, touch) > r.model.cut && predict(r.model, noise) < r.model.cut);
});

test('sound model: not ready with old runs (3 measurements) or too few touches', () => {
  const { peaks, events } = syntheticMatch(7);
  assert.equal(trainModel([labelMatch(events.slice(0, 50), peaks)]).ready, false);
  const old = peaks.map((p) => p.slice(0, 3));
  assert.equal(trainModel([labelMatch(events, old)]).ready, false);
});

test('a learn-only run keeps all measurements and adds no suggestions; the detector offers the model', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { buildApp } = await import('../src/index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-'));
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') });
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'Tagged' } })).json();
  const { peaks, events } = syntheticMatch(3);
  for (const e of events) await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action: e.action, t: Math.round(e.t * 100) / 100, set_no: 1 } });
  const r = await app.inject({ method: 'POST', url: `/api/matches/${m.id}/suggestions`, payload: {
    events: peaks.slice(0, 20).map((p) => ({ action: 'attack', t: p[0] })), params: { learnOnly: true }, candidates: peaks,
  } });
  assert.equal(r.json().inserted, 0);
  const all = (await app.inject({ url: `/api/matches/${m.id}` })).json().events;
  assert.equal(all.filter((e) => e.status === 'suggested').length, 0);
  const d = (await app.inject({ url: '/api/detector' })).json();
  assert.equal(d.model.ready, true);
  assert.equal(d.model.better, true);
  assert.equal(d.use.model.w.length, 13);
  // Switched off: no model, standard thresholds.
  await app.inject({ method: 'PUT', url: '/api/detector', payload: { off: true } });
  assert.equal((await app.inject({ url: '/api/detector' })).json().use.model, undefined);
  await app.close();
});
