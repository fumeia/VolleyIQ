// Second opinion on auto-detected ball contacts: for each touch the app sends one
// picture (three video frames around the sound: just before, at, just after) and the
// vision model says whether a player touches the ball there, which side, which
// action and the jersey number. Uses whichever AI backend is configured (see ai.js).
import { aiComplete, aiConfig, parseJson } from './ai.js';

export const MAX_TOUCHES = 16;
export const ACTIONS = ['serve', 'receive', 'set', 'attack', 'block', 'dig', 'freeball', 'unknown'];

const SYSTEM = `You check automatically detected ball contacts in an indoor volleyball match video.
Each image is ONE detected sound that may be a ball contact. It has three panels: top left = 0.3 s before the sound, top right = at the sound, bottom left = 0.2 s after. The bottom-right panel names the touch.

For every image decide:
- contact: "yes" if a player clearly plays the ball at that moment, "no" if nobody touches the ball (a bounce, a clap, the ball hitting the floor or a wall, a whistle), "unsure" if you cannot tell.
- team: "ours" or "theirs" for the player who touches it, using the court side you are told our team plays on; "unsure" if you cannot tell.
- action: serve, receive (first touch of a serve), set, attack, block (at the net, hands above it), dig (defending an attack), freeball (an easy ball played over), or unknown.
- jersey: the number on the touching player's shirt only if you can actually read it, else null.
- confidence: 0 to 1 for your whole answer about this touch.

Rules: judge only what the panels show. The ball is small: look for it near hands and arms. Use the order of the touches (a rally goes serve, receive, set, attack, then block or dig on the other side) only to break ties, never against what you see. Never invent a number.`;

const TOUCH = {
  type: 'object',
  additionalProperties: false,
  properties: {
    i: { type: 'integer' },
    contact: { type: 'string', enum: ['yes', 'no', 'unsure'] },
    team: { type: 'string', enum: ['ours', 'theirs', 'unsure'] },
    action: { type: 'string', enum: ACTIONS },
    jersey: { type: ['integer', 'null'] },
    confidence: { type: 'number' },
  },
  required: ['i', 'contact', 'team', 'action', 'jersey', 'confidence'],
};
const SCHEMA = { type: 'object', additionalProperties: false, properties: { touches: { type: 'array', items: TOUCH } }, required: ['touches'] };
const JSON_HINT = 'Return ONLY a JSON object {"touches":[{"i":1,"contact":"yes|no|unsure","team":"ours|theirs|unsure","action":"serve|receive|set|attack|block|dig|freeball|unknown","jersey":7 or null,"confidence":0.8}]} with one entry per image, i = the touch number shown in its panel.';

/** Keep only well-formed answers, one per asked touch number. */
export function cleanAnswer(data, n) {
  const out = new Map();
  for (const t of Array.isArray(data?.touches) ? data.touches : []) {
    const i = Number(t?.i);
    if (!Number.isInteger(i) || i < 1 || i > n || out.has(i)) continue;
    const jersey = Number.isInteger(t.jersey) && t.jersey >= 0 && t.jersey <= 99 ? t.jersey : null;
    out.set(i, {
      i,
      contact: ['yes', 'no', 'unsure'].includes(t.contact) ? t.contact : 'unsure',
      team: ['ours', 'theirs', 'unsure'].includes(t.team) ? t.team : 'unsure',
      action: ACTIONS.includes(t.action) ? t.action : 'unknown',
      jersey,
      confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0)),
    });
  }
  return [...out.values()].sort((a, b) => a.i - b.i);
}

/** [check] is injectable for tests; otherwise enabled when an AI backend is set. */
export function makeTouchChecker(env = {}, check = null) {
  const cfg = aiConfig(env, 'touches');
  const model = cfg?.model ?? null;
  if (check) return { enabled: true, model, check };
  if (!cfg) return { enabled: false, model, check: async () => { throw new Error('disabled'); } };
  return {
    enabled: true,
    model,
    /** [images] one per touch, in order; [context] { ourSide, roster: [{number, role}] }. */
    async check(images, context) {
      const side = context.ourSide === 'near' ? 'the NEAR half (bottom of the picture, closer to the camera)'
        : context.ourSide === 'far' ? 'the FAR half (top of the picture, beyond the net)' : 'an unknown half (answer team "unsure" unless it is obvious)';
      const roster = (context.roster ?? []).map((p) => `#${p.number}${p.role ? ` ${p.role}` : ''}`).join(', ');
      const text = `Our team plays on ${side} in this rally.${roster ? ` Our shirt numbers: ${roster}.` : ''} There are ${images.length} touches, numbered 1 to ${images.length} in time order.`;
      const reply = await aiComplete(cfg, { system: SYSTEM, text, images, maxTokens: 300 + 120 * images.length, schema: SCHEMA, jsonHint: JSON_HINT });
      return cleanAnswer(parseJson(reply), images.length);
    },
  };
}
