// Turns a match's computed statistics into a few coach-friendly bullet points
// (English or German) with a Claude model. Grounded: the model is told to use
// only the numbers it is given. Gated by the same ANTHROPIC_API_KEY as the scan.

const SYSTEM = `You are an experienced volleyball analyst writing a short briefing for the team's own coach.
You are given a JSON object of computed statistics for one match or a season (totals, per-player lines, rotations, point sources). Write concise, specific, actionable bullet points.

Rules:
- Use ONLY the numbers in the JSON. Never invent players, scores or trends that are not there.
- Each bullet is one sentence, concrete, and names the player or rotation it is about where relevant.
- Mix what went well with what to work on. Prefer the biggest swings (efficiency, side-out %, reception, errors).
- No preamble, no headings — just the bullets.
- Write in the requested language (en = English, de = German).`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { bullets: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 7 } },
  required: ['bullets'],
};

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in response');
  return JSON.parse(m[0]);
}

/** [generate] is injectable for tests; env.ANTHROPIC_API_KEY enables it. */
export function makeInsighter(env = {}, generate = null) {
  const apiKey = env.ANTHROPIC_API_KEY || env.VISION_API_KEY || null;
  const model = env.VISION_MODEL || 'claude-opus-5-5';
  if (generate) return { enabled: true, model, generate };
  if (!apiKey) return { enabled: false, model, generate: async () => { throw new Error('disabled'); } };

  return {
    enabled: true,
    model,
    async generate(stats, lang) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      const prompt = `Language: ${lang === 'de' ? 'de' : 'en'}\nStatistics:\n${JSON.stringify(stats)}`;
      const base = { model, max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: prompt }] };
      let resp;
      try {
        resp = await client.messages.create({ ...base, output_config: { format: { type: 'json_schema', schema: SCHEMA } } });
      } catch (e) {
        if (e?.status !== 400) throw e;
        resp = await client.messages.create({
          ...base,
          messages: [{ role: 'user', content: `${prompt}\n\nReturn ONLY a JSON object {"bullets": [...]}, no prose.` }],
        });
      }
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const out = parseJson(text);
      return Array.isArray(out.bullets) ? out.bullets.slice(0, 7).map(String) : [];
    },
  };
}
