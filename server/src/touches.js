// Second opinion on auto-detected ball contacts: for each touch the app sends one
// picture (three video frames around the sound: just before, at, just after) and the
// vision model says whether a player touches the ball there, which side, which
// action and the jersey number. Uses whichever AI backend is configured (see ai.js).
import { aiComplete, aiConfig, parseJson } from './ai.js';

export const MAX_TOUCHES = 16;
export const ACTIONS = ['serve', 'receive', 'set', 'attack', 'block', 'dig', 'freeball', 'unknown'];
/** Where the touching player stands in their own half, as seen in the picture (front = at the net). */
export const POSITIONS = ['front-left', 'front-middle', 'front-right', 'back-left', 'back-middle', 'back-right', 'unsure'];
/** Solved examples sent along with a check when asked for (the coach's own corrections). */
export const MAX_EXAMPLES = 3;

const SYSTEM = `You check automatically detected ball contacts in an indoor volleyball match video.
Each image is ONE detected sound that may be a ball contact. It has three panels: top left = 0.3 s before the sound, top right = at the sound, bottom left = 0.2 s after. The bottom-right panel names the touch.

For every image decide:
- contact: "yes" if a player clearly plays the ball at that moment, "no" if nobody touches the ball (a bounce, a clap, the ball hitting the floor or a wall, a whistle), "unsure" if you cannot tell.
- team: "ours" or "theirs" for the player who touches it, using the court side you are told our team plays on; "unsure" if you cannot tell.
- action: serve, receive (first touch of a serve), set, attack, block (at the net, hands above it), dig (defending an attack), freeball (an easy ball played over), or unknown.
- jersey: the number on the touching player's shirt only if you can actually read it, else null.
- position: where the touching player stands in their own half: front (close to the net) or back, and left / middle / right as seen in the picture; "unsure" if you cannot tell.
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
    position: { type: 'string', enum: POSITIONS },
    confidence: { type: 'number' },
  },
  required: ['i', 'contact', 'team', 'action', 'jersey', 'position', 'confidence'],
};
const SCHEMA = { type: 'object', additionalProperties: false, properties: { touches: { type: 'array', items: TOUCH } }, required: ['touches'] };
const JSON_HINT = 'Return ONLY a JSON object {"touches":[{"i":1,"contact":"yes|no|unsure","team":"ours|theirs|unsure","action":"serve|receive|set|attack|block|dig|freeball|unknown","jersey":7 or null,"position":"front-left|front-middle|front-right|back-left|back-middle|back-right|unsure","confidence":0.8}]} with one entry per image, i = the touch number shown in its panel.';

/** Keep only well-formed answers, one per asked touch number. */
export function cleanAnswer(data, n, from = 1) {
  const out = new Map();
  for (const t of Array.isArray(data?.touches) ? data.touches : []) {
    const i = Number(t?.i);
    if (!Number.isInteger(i) || i < from || i > n || out.has(i)) continue;
    const jersey = Number.isInteger(t.jersey) && t.jersey >= 0 && t.jersey <= 99 ? t.jersey : null;
    out.set(i, {
      i,
      contact: ['yes', 'no', 'unsure'].includes(t.contact) ? t.contact : 'unsure',
      team: ['ours', 'theirs', 'unsure'].includes(t.team) ? t.team : 'unsure',
      action: ACTIONS.includes(t.action) ? t.action : 'unknown',
      jersey,
      position: POSITIONS.includes(t.position) ? t.position : 'unsure',
      confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0)),
    });
  }
  return [...out.values()].sort((a, b) => a.i - b.i);
}

/**
 * Splits the pictures into requests of at most [budget] characters of base64 each
 * ([fixed] is what every request carries besides them, e.g. the examples). Gateways sit
 * behind a web server that refuses large requests (nginx: 1 MB by default).
 * Returns index ranges [from, to) into [images].
 */
export function chunkBySize(images, budget, fixed = 0) {
  const out = [];
  let from = 0, size = fixed;
  images.forEach((im, k) => {
    const n = im.data.length;
    if (k > from && size + n > budget) { out.push([from, k]); from = k; size = fixed; }
    size += n;
  });
  if (images.length) out.push([from, images.length]);
  return out;
}

const tooLarge = (e) => /\b413\b|too large/i.test(String(e?.message ?? e));

/** [check] is injectable for tests; otherwise enabled when an AI backend is set. */
export function makeTouchChecker(env = {}, check = null) {
  const cfg = aiConfig(env, 'touches');
  const model = cfg?.model ?? null;
  // Characters of base64 per request (≈ bytes); leaves room under a 1 MB limit for the JSON around it.
  const budget = (Number(env.AI_MAX_REQUEST_KB) || 700) * 1000;
  if (check) return { enabled: true, model, check };
  if (!cfg) return { enabled: false, model, check: async () => { throw new Error('disabled'); } };

  /** One request: the touches [from..to) of [n] (numbers in their panels are from + 1 ..). */
  async function ask(images, from, n, context, ex, onUsage) {
    const side = context.ourSide === 'near' ? 'the NEAR half (bottom of the picture, closer to the camera)'
      : context.ourSide === 'far' ? 'the FAR half (top of the picture, beyond the net)' : 'an unknown half (answer team "unsure" unless it is obvious)';
    const roster = (context.roster ?? []).map((p) => `#${p.number}${p.role ? ` ${p.role}` : ''}`).join(', ');
    const solved = ex.length
      ? `The first ${ex.length} image${ex.length === 1 ? ' is a solved example' : 's are solved examples'} from earlier rallies, checked by the coach (their panel says "Example"); do not answer for them:\n${ex.map((x, k) => `Example ${k + 1}: ${describe(x.label)}.`).join('\n')}\nThe images after them are the touches to check.\n`
      : '';
    const which = images.length === n ? `There are ${n} touches, numbered 1 to ${n} in time order.`
      : `The rally has ${n} touches in time order; these images are touches ${from + 1} to ${from + images.length}. Answer for these only, with i = the touch number written in each panel.`;
    const text = `${solved}Our team plays on ${side} in this rally.${roster ? ` Our shirt numbers: ${roster}.` : ''} ${which}`;
    const all = [...ex.map((x) => ({ media_type: 'image/jpeg', data: x.image })), ...images];
    // Generous output allowance: thinking models (e.g. Gemini Flash) spend tokens before the answer;
    // only what is used is paid. One retry with even more room when the answer is empty or cut off.
    const run = (maxTokens) => aiComplete(cfg, { system: SYSTEM, text, images: all, maxTokens, schema: SCHEMA, jsonHint: JSON_HINT, onUsage: onUsage?.(images.length) })
      .then((reply) => { const d = parseJson(reply); return Array.isArray(d) ? { touches: d } : d; });
    let data;
    try {
      data = await run(Math.min(8000, 2000 + 300 * images.length));
    } catch (e) {
      if (tooLarge(e) || !/JSON|empty reply|output tokens|Unexpected|Unterminated/i.test(String(e?.message))) throw e;
      data = await run(16000);
    }
    return cleanAnswer(data, from + images.length, from + 1);
  }

  /** Asks for [from, to); a request the gateway refuses as too large is split in half and retried. */
  async function askSplitting(images, from, to, n, context, ex, onUsage) {
    try {
      return await ask(images.slice(from, to), from, n, context, ex, onUsage);
    } catch (e) {
      if (!tooLarge(e)) throw e;
      if (ex.length) return askSplitting(images, from, to, n, context, [], onUsage);
      if (to - from < 2) throw new Error('the AI gateway refuses even one picture as too large (raise its request size limit, or lower AI_MAX_REQUEST_KB)');
      const mid = (from + to) >> 1;
      return [...await askSplitting(images, from, mid, n, context, ex, onUsage), ...await askSplitting(images, mid, to, n, context, ex, onUsage)];
    }
  }

  return {
    enabled: true,
    model,
    /**
     * [images] one per touch, in order; [context] { ourSide, roster: [{number, role}] };
     * [examples] solved touches from this coach ({ image, label }), sent first in every
     * request (left out when they would not fit). [onUsage](count) gives the usage
     * callback for a request of [count] touches. Large rallies go in several requests.
     */
    async check(images, context, { examples = [], onUsage = null } = {}) {
      let ex = examples.slice(0, MAX_EXAMPLES);
      let fixed = ex.reduce((a, x) => a + x.image.length, 0);
      if (fixed > budget / 3) { ex = []; fixed = 0; }
      const out = [];
      for (const [from, to] of chunkBySize(images, budget, fixed)) {
        out.push(...await askSplitting(images, from, to, images.length, context, ex, onUsage));
      }
      return out;
    },
  };
}
/** An example's answer in words (its team relative to the side named in that example). */
function describe(l) {
  if (l.contact === 'no') return 'no ball contact';
  const parts = [l.action !== 'unknown' ? `a ${l.action}` : 'a touch', l.team === 'ours' ? `by our team (on the ${l.ourSide ?? 'unknown'} half)` : l.team === 'theirs' ? `by the other team (our team was on the ${l.ourSide ?? 'unknown'} half)` : null,
    l.jersey != null ? `shirt #${l.jersey}` : null];
  return parts.filter(Boolean).join(', ');
}

/** A stored example's label, cleaned: what the coach saved for that touch. */
export function cleanLabel(l) {
  if (!l || typeof l !== 'object') return null;
  const contact = l.contact === 'no' ? 'no' : 'yes';
  return {
    contact,
    team: ['ours', 'theirs'].includes(l.team) ? l.team : 'unsure',
    action: ACTIONS.includes(l.action) ? l.action : 'unknown',
    jersey: Number.isInteger(l.jersey) && l.jersey >= 0 && l.jersey <= 99 ? l.jersey : null,
    ourSide: ['near', 'far'].includes(l.ourSide) ? l.ourSide : null,
  };
}
