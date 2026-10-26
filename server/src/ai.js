// One AI entry point for the optional vision scan and the coach summary. It talks
// to either an OpenAI-compatible endpoint (a LiteLLM proxy, a self-hosted gateway,
// OpenAI itself) or the Anthropic API, whichever the server is configured for.
// Nothing is enabled unless credentials are set, so the features stay hidden
// otherwise. The SDK is only imported for the Anthropic path, lazily.

/**
 * Pick the backend from the environment. LiteLLM / OpenAI-compatible wins when set
 * (self-hosted or an organisation's gateway); otherwise the Anthropic API.
 *  - LITELLM_BASE_URL (+ LITELLM_API_KEY, LITELLM_MODEL)   e.g. https://litellm.example.com
 *  - or OPENAI_BASE_URL (+ OPENAI_API_KEY, OPENAI_MODEL)
 *  - or ANTHROPIC_API_KEY (+ VISION_MODEL, default claude-opus-5-5)
 * [task] picks a per-feature model when one is set: SCAN_MODEL for the match-sheet
 * scan (needs image input), SUMMARY_MODEL for the coach summary (text only),
 * TOUCH_MODEL for the AI check of detected touches (image input; falls back to SCAN_MODEL).
 */
export function aiConfig(env = {}, task = null) {
  const own = task === 'scan' ? env.SCAN_MODEL : task === 'summary' ? env.SUMMARY_MODEL : task === 'touches' ? env.TOUCH_MODEL || env.SCAN_MODEL : null;
  const liteUrl = env.LITELLM_BASE_URL || env.OPENAI_BASE_URL;
  const liteKey = env.LITELLM_API_KEY || env.OPENAI_API_KEY || env.LITELLM_KEY;
  if (liteUrl && liteKey) {
    return { kind: 'openai', baseUrl: liteUrl, apiKey: liteKey, model: own || env.LITELLM_MODEL || env.OPENAI_MODEL || env.VISION_MODEL || 'gpt-4o' };
  }
  const anthKey = env.ANTHROPIC_API_KEY || env.VISION_API_KEY;
  if (anthKey) return { kind: 'anthropic', apiKey: anthKey, model: own || env.VISION_MODEL || 'claude-opus-5-5' };
  return null;
}

/** Parse the model's reply as JSON, tolerating a ```json fence or surrounding prose. */
export function parseJson(text) {
  try { return JSON.parse(text); } catch { /* try to find the JSON body */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in response');
  return JSON.parse(m[0]);
}

/**
 * Run one completion and return the text. [images] are { media_type, data(base64) }.
 * [schema] (Anthropic structured output) and [jsonHint] (a shape reminder for the
 * OpenAI path) are both optional; pass them when you want JSON back. [onUsage] gets
 * { cost, tokensIn, tokensOut } after the call (cost when the gateway reports it, else null).
 */
export async function aiComplete(cfg, { system, text, images = [], maxTokens = 2000, schema = null, jsonHint = null, onUsage = null }) {
  if (cfg.kind === 'anthropic') return anthropicComplete(cfg, { system, text, images, maxTokens, schema, onUsage });
  return openaiComplete(cfg, { system, text, images, maxTokens, jsonHint, onUsage });
}

const report = (onUsage, u) => { try { onUsage?.(u); } catch { /* bookkeeping never breaks a call */ } };

async function anthropicComplete(cfg, { system, text, images, maxTokens, schema, onUsage }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const content = [
    ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
    { type: 'text', text },
  ];
  const base = { model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  let resp;
  try {
    resp = schema
      ? await client.messages.create({ ...base, output_config: { format: { type: 'json_schema', schema } } })
      : await client.messages.create(base);
  } catch (e) {
    if (e?.status !== 400 || !schema) throw e;
    resp = await client.messages.create({
      ...base,
      messages: [{ role: 'user', content: [...content, { type: 'text', text: 'Respond with ONLY the JSON object, no prose and no markdown fences.' }] }],
    });
  }
  report(onUsage, { cost: null, tokensIn: resp.usage?.input_tokens ?? null, tokensOut: resp.usage?.output_tokens ?? null });
  return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

/** The OpenAI-compatible base without a trailing /v1 or /chat/completions. */
export const gatewayRoot = (url) => url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/v1$/, '');

async function openaiComplete(cfg, { system, text, images, maxTokens, jsonHint, onUsage }) {
  // Accepts the gateway root, .../v1 or the full .../chat/completions URL.
  const url = /\/chat\/completions\/?$/.test(cfg.baseUrl) ? cfg.baseUrl.replace(/\/+$/, '') : `${gatewayRoot(cfg.baseUrl)}/v1/chat/completions`;
  const userContent = images.length
    ? [
        ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}` } })),
        { type: 'text', text: jsonHint ? `${text}\n\n${jsonHint}` : text },
      ]
    : (jsonHint ? `${text}\n\n${jsonHint}` : text);
  const body = {
    model: cfg.model,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
    ...(jsonHint ? { response_format: { type: 'json_object' } } : {}),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Some gateways reject response_format: retry once without it.
    if (res.status === 400 && jsonHint) {
      const r2 = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, response_format: undefined }),
      });
      if (r2.ok) return pickText(await r2.json(), r2, onUsage);
    }
    // The gateway's own message (e.g. "invalid model" or "budget exceeded"), never the key.
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`model gateway ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return pickText(await res.json(), res, onUsage);
}

/** The reply text; also reports the cost (LiteLLM's response header, or OpenRouter's usage.cost) and tokens. */
function pickText(data, res, onUsage) {
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const cost = num(res?.headers?.get?.('x-litellm-response-cost')) ?? num(data?.usage?.cost);
  report(onUsage, { cost, tokensIn: data?.usage?.prompt_tokens ?? null, tokensOut: data?.usage?.completion_tokens ?? null });
  const msg = data?.choices?.[0]?.message;
  if (typeof msg?.content === 'string') return msg.content;
  if (Array.isArray(msg?.content)) return msg.content.map((c) => c.text ?? '').join('');
  return '';
}

/**
 * Spend and budget of the key, from a LiteLLM gateway (GET /key/info). null when the
 * gateway does not answer it (another gateway, the Anthropic API, an old LiteLLM).
 */
export async function keyInfo(cfg, fetchFn = fetch) {
  if (cfg?.kind !== 'openai') return null;
  try {
    const res = await fetchFn(`${gatewayRoot(cfg.baseUrl)}/key/info`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    if (!res.ok) return null;
    const info = (await res.json())?.info ?? {};
    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    return { spend: num(info.spend), max: num(info.max_budget), resetAt: typeof info.budget_reset_at === 'string' ? info.budget_reset_at : null };
  } catch {
    return null;
  }
}
