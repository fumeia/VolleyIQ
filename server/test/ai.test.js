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
