import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiComplete, aiConfig, parseJson } from '../src/ai.js';
import { makeVisionScanner } from '../src/vision.js';
import { makeInsighter } from '../src/insights.js';

test('aiConfig picks LiteLLM/OpenAI over Anthropic, else Anthropic, else null', () => {
  assert.equal(aiConfig({ LITELLM_BASE_URL: 'https://x', LITELLM_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' }).kind, 'openai');
  assert.equal(aiConfig({ ANTHROPIC_API_KEY: 'a' }).kind, 'anthropic');
  assert.equal(aiConfig({}), null);
  const env = { LITELLM_BASE_URL: 'https://x', LITELLM_API_KEY: 'k', LITELLM_MODEL: 'base', SCAN_MODEL: 'eyes' };
  assert.equal(aiConfig(env, 'scan').model, 'eyes');
  assert.equal(aiConfig(env, 'summary').model, 'base');
});

test('parseJson tolerates fences and surrounding prose', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Here you go: {"b":2} thanks'), { b: 2 });
});

test('openai-compatible path builds a chat request with image + json_object and parses the reply', async () => {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"teams":{"A":"X","B":"Y"}}' } }] }) };
  };
  try {
    const cfg = aiConfig({ LITELLM_BASE_URL: 'https://litellm.example.com', LITELLM_API_KEY: 'sk', LITELLM_MODEL: 'gpt-4o' });
    const text = await aiComplete(cfg, { system: 'sys', text: 'read it', images: [{ media_type: 'image/jpeg', data: 'AAA' }], jsonHint: 'return json' });
    assert.deepEqual(parseJson(text).teams, { A: 'X', B: 'Y' });
    const c = calls[0];
    assert.equal(c.url, 'https://litellm.example.com/v1/chat/completions');
    assert.equal(c.auth, 'Bearer sk');
    assert.equal(c.body.model, 'gpt-4o');
    assert.equal(c.body.response_format.type, 'json_object');
    const user = c.body.messages[1].content;
    assert.equal(user[0].type, 'image_url');
    assert.match(user[0].image_url.url, /^data:image\/jpeg;base64,AAA$/);
  } finally { global.fetch = orig; }
});

test('scanner and insighter are enabled via a LiteLLM config and call the gateway', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"teams":{"A":"A","B":"B"},"sets":[],"rosters":{"A":[],"B":[]},"confidence":"low","date":null,"league":null,"matchNo":null,"winner":null,"setsWon":null}' } }] }) });
  try {
    const env = { LITELLM_BASE_URL: 'https://x', LITELLM_API_KEY: 'k', LITELLM_MODEL: 'm' };
    const v = makeVisionScanner(env);
    assert.equal(v.enabled, true);
    const data = await v.scan([{ media_type: 'image/png', data: 'B' }]);
    assert.equal(data.teams.A, 'A');

    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"bullets":["one","two"]}' } }] }) });
    const ins = makeInsighter(env);
    assert.deepEqual(await ins.generate({ x: 1 }, 'en'), ['one', 'two']);
  } finally { global.fetch = orig; }
});

test('gateway URL: root, /v1 and trailing slashes all reach /v1/chat/completions', async () => {
  const { gatewayRoot } = await import('../src/ai.js');
  for (const u of ['https://gw.example.com', 'https://gw.example.com/', 'https://gw.example.com/v1', 'https://gw.example.com/v1/']) {
    assert.equal(`${gatewayRoot(u)}/v1/chat/completions`, 'https://gw.example.com/v1/chat/completions');
  }
});

test('touch check: answers are cleaned, the route validates input and has a daily cap', async () => {
  const { cleanAnswer } = await import('../src/touches.js');
  const got = cleanAnswer({ touches: [{ i: 1, contact: 'yes', team: 'ours', action: 'dig', jersey: 7, confidence: 0.9 }, { i: 1, contact: 'no' }, { i: 5 }, { i: 2, contact: 'maybe', action: 'spike', jersey: 'x', confidence: 3 }] }, 2);
  assert.deepEqual(got, [
    { i: 1, contact: 'yes', team: 'ours', action: 'dig', jersey: 7, position: 'unsure', confidence: 0.9 },
    { i: 2, contact: 'unsure', team: 'unsure', action: 'unknown', jersey: null, position: 'unsure', confidence: 1 },
  ]);

  const { buildApp } = await import('../src/index.js');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const calls = [];
  const fake = { enabled: true, model: 'test', check: async (images, ctx) => { calls.push(ctx); return images.map((_, k) => ({ i: k + 1, contact: 'yes', team: 'ours', action: 'set', jersey: null, confidence: 0.7 })); } };
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'viq-')), WEB_DIST: '/none', AI_DAILY_LIMIT: '1' }, { touches: fake });
  assert.equal((await app.inject({ url: '/api/ai/touches/enabled' })).json().enabled, true);
  assert.equal((await app.inject({ method: 'POST', url: '/api/ai/touches', payload: { images: [] } })).statusCode, 400);
  const img = { media_type: 'image/jpeg', data: 'abc' };
  const ok = await app.inject({ method: 'POST', url: '/api/ai/touches', payload: { images: [img, img], ourSide: 'far', roster: [{ number: 7, role: 'OH' }, { number: 'x' }] } });
  assert.equal(ok.json().touches.length, 2);
  assert.deepEqual(calls[0], { ourSide: 'far', roster: [{ number: 7, role: 'OH' }] });
  assert.equal((await app.inject({ method: 'POST', url: '/api/ai/touches', payload: { images: [img] } })).statusCode, 429);
  await app.close();
});

test('cost is read from the LiteLLM header or the usage block', async () => {
  const orig = global.fetch;
  const seen = [];
  const reply = (headers, usage) => async () => ({ ok: true, status: 200, headers: new Headers(headers), json: async () => ({ choices: [{ message: { content: 'hi' } }], usage }) });
  try {
    const cfg = aiConfig({ LITELLM_BASE_URL: 'https://gw', LITELLM_API_KEY: 'k' });
    global.fetch = reply({ 'x-litellm-response-cost': '0.0012' }, { prompt_tokens: 900, completion_tokens: 40 });
    await aiComplete(cfg, { system: 's', text: 't', onUsage: (u) => seen.push(u) });
    global.fetch = reply({}, { cost: 0.5 });
    await aiComplete(cfg, { system: 's', text: 't', onUsage: (u) => seen.push(u) });
    global.fetch = reply({}, undefined);
    await aiComplete(cfg, { system: 's', text: 't', onUsage: (u) => seen.push(u) });
    assert.deepEqual(seen, [{ cost: 0.0012, tokensIn: 900, tokensOut: 40 }, { cost: 0.5, tokensIn: null, tokensOut: null }, { cost: null, tokensIn: null, tokensOut: null }]);

    const { keyInfo } = await import('../src/ai.js');
    let asked = null;
    const info = await keyInfo(cfg, async (url, o) => { asked = [url, o.headers.Authorization]; return { ok: true, json: async () => ({ info: { spend: 4.5, max_budget: 30, budget_reset_at: '2026-11-01T00:00:00Z' } }) }; });
    assert.deepEqual(asked, ['https://gw/key/info', 'Bearer k']);
    assert.deepEqual(info, { spend: 4.5, max: 30, resetAt: '2026-11-01T00:00:00Z' });
    assert.equal(await keyInfo(cfg, async () => ({ ok: false })), null);
  } finally { global.fetch = orig; }
});

test('AI learning: examples go along when asked, feedback adds up per field, budget and cost per touch', async () => {
  const { buildApp } = await import('../src/index.js');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const calls = [];
  const fake = {
    enabled: true, model: 'm',
    check: async (images, ctx, opts) => {
      calls.push(opts.examples.map((x) => x.label.action));
      opts.onUsage({ cost: 0.01 * images.length, tokensIn: 1, tokensOut: 1 });
      return images.map((_, k) => ({ i: k + 1, contact: 'yes', team: 'ours', action: 'set', jersey: null, position: 'front-left', confidence: 0.7 }));
    },
  };
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'viq-')), WEB_DIST: '/none', AI_CURRENCY: 'CHF' },
    { touches: fake, budget: async () => ({ spend: 2, max: 30, resetAt: null }) });
  const img = { media_type: 'image/jpeg', data: 'abc' };
  for (const action of ['dig', 'dig', 'set', 'attack', 'receive']) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/ai/examples', payload: { image: 'QUJD', label: { contact: 'yes', team: 'ours', action, jersey: 4 } } })).statusCode, 200);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/ai/examples', payload: { image: 'QUJD', label: null } })).statusCode, 400);
  await app.inject({ method: 'POST', url: '/api/ai/touches', payload: { images: [img, img], examples: true } });
  await app.inject({ method: 'POST', url: '/api/ai/touches', payload: { images: [img, img] } });
  assert.deepEqual(calls, [['receive', 'attack', 'set'], []], 'newest first, one per action');

  await app.inject({ method: 'POST', url: '/api/ai/feedback', payload: { items: [
    { field: 'action', confidence: 0.9, correct: true }, { field: 'action', confidence: 0.3, correct: false },
    { field: 'jersey', confidence: 0.8, correct: false }, { field: 'nope', correct: true }, { field: 'team', correct: 'yes' },
  ] } });
  const stats = (await app.inject({ url: '/api/ai/stats' })).json();
  assert.deepEqual(stats.fields.action, { n: 2, correct: 1, sureN: 1, sureCorrect: 1 });
  assert.equal(stats.fields.jersey.n, 1);
  assert.equal(stats.fields.team.n, 0);
  assert.equal(stats.examples, 5);

  const b = (await app.inject({ url: '/api/ai/budget' })).json();
  assert.equal(b.currency, 'CHF');
  assert.equal(b.remaining, 28);
  assert.equal(b.source, 'gateway');
  assert.ok(Math.abs(b.perTouch - 0.01) < 1e-9);
  assert.equal(b.today.used, 2);

  // Answers kept per suggestion, and not shown on public links.
  const m = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'm' } })).json();
  const e = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/events`, payload: { action: 'dig', t: 3, status: 'confirmed' } })).json();
  assert.equal((await app.inject({ method: 'POST', url: `/api/matches/${m.id}/ai`, payload: { results: [{ id: e.id, ai: { action: 'set', confidence: 0.8 } }, { id: 'x' }] } })).json().updated, 1);
  assert.deepEqual((await app.inject({ url: `/api/matches/${m.id}` })).json().events[0].ai, { action: 'set', confidence: 0.8 });
  const token = (await app.inject({ method: 'POST', url: `/api/matches/${m.id}/share`, payload: {} })).json().share_token;
  assert.equal('ai' in (await app.inject({ url: `/api/share/${token}` })).json().events[0], false);
  await app.close();
});
