// Turns a match's computed statistics into a few coach-friendly bullet points
// (English or German). Grounded: the model is told to use only the numbers it is
// given. Uses whichever AI backend is configured (see ai.js).
import { aiComplete, aiConfig, parseJson } from './ai.js';

const SYSTEM = `You are an experienced volleyball analyst writing a short briefing for the team's own coach.
You are given a JSON object of computed statistics for one match or a season (totals, per-player lines, rotations, point sources). Write concise, specific, actionable bullet points.

Rules:
- Use ONLY the numbers in the JSON. Never invent players, scores or trends that are not there.
- Each bullet is one sentence, concrete, and names the player or rotation it is about where relevant.
- Mix what went well with what to work on. Prefer the biggest swings (efficiency, side-out %, reception, errors).
- No preamble, no headings, just the bullets.
- Write in the requested language (en = English, de = German).`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { bullets: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 7 } },
  required: ['bullets'],
};

/** [generate] is injectable for tests; otherwise enabled when an AI backend is set. */
export function makeInsighter(env = {}, generate = null) {
  const cfg = aiConfig(env, 'summary');
  const model = cfg?.model ?? (env.VISION_MODEL || 'claude-opus-5-5');
  if (generate) return { enabled: true, model, generate };
  if (!cfg) return { enabled: false, model, generate: async () => { throw new Error('disabled'); } };

  return {
    enabled: true,
    model,
    async generate(stats, lang, { onUsage = null } = {}) {
      const text = await aiComplete(cfg, {
        system: SYSTEM,
        text: `Language: ${lang === 'de' ? 'de' : 'en'}\nStatistics:\n${JSON.stringify(stats)}`,
        maxTokens: 1200,
        schema: SCHEMA,
        jsonHint: 'Return ONLY a JSON object of the form {"bullets": ["...", "..."]} with 2-7 items.',
        onUsage,
      });
      const out = parseJson(text);
      return Array.isArray(out.bullets) ? out.bullets.slice(0, 7).map(String) : [];
    },
  };
}
