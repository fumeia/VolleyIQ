// Reads the summary fields off a photo of an official (FIVB-style) volleyball match
// sheet with a vision model, so a match can be pre-filled instead of typed.
// Disabled unless an AI backend is configured (LiteLLM / OpenAI-compatible or
// Anthropic, see ai.js).
import { aiComplete, aiConfig, parseJson } from './ai.js';

const SYSTEM = `You read official FIVB-style volleyball match sheets (in any language, e.g. "Spielberichtsbogen / Feuille de match / Scoresheet"), handwritten or printed, and return only the clearly legible summary fields.

Layout you will see:
- Two teams, A (top-left, "A") and B. Their names are written at the top next to "Mannschaften/Equipes/Squadra".
- Header: league ("Liga/Ligue", e.g. "3.L"), match number ("Spiel Nr / Match No"), venue ("Halle/Salle"), date ("Datum/Date"), start time ("Zeit/Heure").
- Per-set blocks ("SATZ/SET 1..5"): each has two team halves (left and right; the team letter A or B and its name are in each half's header, and it can change per set). Each half has six columns I II III IV V VI:
  * row "Startaufstellung / Formation initiale": the starting jersey numbers, one per column (position I..VI);
  * rows "Spielerauswechslung / Remplacement": a substitute's jersey number entering in that column, and below it ("Spielstand / Résultat") the score at that moment written as own:opponent (e.g. 4:9);
  * rows "Aufschlagrunde / Tours au service" 1..8: the team's own score when it lost the serve, for each service turn of the player in that column. Write each cell as its number, "X" for a crossed-out cell, or null when empty. A circled number is the set's last score: give it as the number.
  * "T" boxes: time-outs as own:opponent scores.
  Read these grids into "flow" (one entry per set played). Copy only what is written; do not compute anything.
- Final result ("Endresultat / Résultat final / Risultato finale", bottom-right): one row per set with each team's final points, and the sets won ("Gewinner/Vainqueur"). Read the per-set final points and the sets won from here.
- Team rosters (right side, "Mannschaften"): license no, jersey number and surname/first name per player. The captain is marked "C" (or a circled/underlined number), liberos are listed in a separate "LIBERO (L)" box.

Rules:
- Only report what you can read with confidence. Use null (or omit list items) for anything illegible; never guess a score or a name.
- Jersey numbers are integers. Names: keep what is written (e.g. "R. Maier", "S.Kulterer").
- sets: one object per set actually played, in order, with each team's final points (e.g. 25 and 22).
- flow: per set, firstServe is the team whose first service cell (row 1, column I) has a score, not an X (the team receiving first has an X there). rounds = the service-round rows top to bottom, each with six cells for columns I..VI.
- Set the overall confidence to "low" for messy handwriting you are unsure about.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    teams: {
      type: 'object', additionalProperties: false,
      properties: { A: { type: ['string', 'null'] }, B: { type: ['string', 'null'] } },
      required: ['A', 'B'],
    },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD if readable' },
    time: { type: ['string', 'null'], description: 'HH:MM' },
    venue: { type: ['string', 'null'] },
    league: { type: ['string', 'null'] },
    matchNo: { type: ['string', 'null'] },
    winner: { type: ['string', 'null'], enum: ['A', 'B', null] },
    setsWon: {
      type: ['object', 'null'], additionalProperties: false,
      properties: { A: { type: 'integer' }, B: { type: 'integer' } }, required: ['A', 'B'],
    },
    sets: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'],
      },
    },
    rosters: {
      type: 'object', additionalProperties: false,
      properties: { A: { $ref: '#/$defs/roster' }, B: { $ref: '#/$defs/roster' } },
      required: ['A', 'B'],
    },
    flow: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          set: { type: 'integer' },
          firstServe: { type: ['string', 'null'], enum: ['A', 'B', null] },
          A: { $ref: '#/$defs/half' },
          B: { $ref: '#/$defs/half' },
        },
        required: ['set', 'firstServe', 'A', 'B'],
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['teams', 'date', 'league', 'matchNo', 'winner', 'setsWon', 'sets', 'rosters', 'confidence'],
  $defs: {
    half: {
      type: 'object', additionalProperties: false,
      properties: {
        start: { type: 'array', items: { type: ['integer', 'null'] }, description: 'starting jersey numbers, columns I..VI' },
        subs: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: { col: { type: 'integer', description: '1..6 = column I..VI' }, in: { type: ['integer', 'null'] }, own: { type: ['integer', 'null'] }, opp: { type: ['integer', 'null'] } },
            required: ['col', 'in', 'own', 'opp'],
          },
        },
        rounds: { type: 'array', items: { type: 'array', items: { type: ['integer', 'string', 'null'] } }, description: 'service-round rows, six cells each: number, "X" or null' },
        timeouts: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, properties: { own: { type: ['integer', 'null'] }, opp: { type: ['integer', 'null'] } }, required: ['own', 'opp'] },
        },
      },
      required: ['start', 'subs', 'rounds', 'timeouts'],
    },
    roster: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          number: { type: ['integer', 'null'] },
          name: { type: 'string' },
          role: { type: ['string', 'null'] },
          captain: { type: 'boolean' },
          libero: { type: 'boolean' },
        },
        required: ['number', 'name', 'captain', 'libero'],
      },
    },
  },
};

const OK_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Shape reminder for OpenAI-compatible backends (LiteLLM) that take no JSON schema.
const JSON_HINT = 'Return ONLY a JSON object with keys: teams{A,B}, date, time, venue, league, matchNo, winner ("A"|"B"|null), setsWon{A,B}, sets (array of {a,b}), rosters{A:[{number,name,role,captain,libero}], B:[...]}, flow (array per set of {set, firstServe:"A"|"B"|null, A:{start:[6 numbers], subs:[{col,in,own,opp}], rounds:[[6 cells: number, "X" or null], ...], timeouts:[{own,opp}]}, B:{same}}), confidence ("high"|"medium"|"low"). Use null for anything unreadable.';

/**
 * Build a scanner. [scan] is injectable so tests don't call the real API.
 * env.ANTHROPIC_API_KEY enables it; env.VISION_MODEL overrides the model.
 */
export function makeVisionScanner(env = {}, scan = null) {
  const cfg = aiConfig(env, 'scan');
  const model = cfg?.model ?? (env.VISION_MODEL || 'claude-opus-5-5');
  if (scan) return { enabled: true, model, scan };
  if (!cfg) return { enabled: false, model, scan: async () => { throw new Error('disabled'); } };

  return {
    enabled: true,
    model,
    async scan(images, { onUsage = null } = {}) {
      const text = await aiComplete(cfg, {
        system: SYSTEM,
        text: 'Read this match sheet and return the summary fields. If several photos are given, they are pages of the same match.',
        images,
        maxTokens: 8000,
        schema: SCHEMA,
        jsonHint: JSON_HINT,
        onUsage,
      });
      return parseJson(text);
    },
  };
}

/** Validate the uploaded images array from the request body. Returns [images, error]. */
export function cleanImages(body, max = 4) {
  const list = Array.isArray(body?.images) ? body.images : null;
  if (!list || !list.length) return [null, 'images required: [{ media_type, data }]'];
  if (list.length > max) return [null, `at most ${max} pictures`];
  const out = [];
  for (const im of list) {
    if (!im || !OK_TYPES.has(im.media_type) || typeof im.data !== 'string') {
      return [null, 'each image needs a media_type (jpeg/png/webp/gif) and base64 data'];
    }
    if (im.data.length > 7_000_000) return [null, 'each image must be under ~5 MB'];
    out.push({ media_type: im.media_type, data: im.data });
  }
  return [out, null];
}

// ---------- shirt numbers from video frames (to fill in a roster) ----------

const NUMBERS_SYSTEM = `You look at frames from a volleyball match video and list the shirt numbers you can read, per team.

- Teams are told apart by shirt colour. Liberos wear a different colour than their team: put them in their team (the one on the same side of the net, or lined up with it) and mark them as libero.
- Only numbers you can read with confidence. A number half hidden, blurred or seen from an angle where 6/9, 1/7 or 3/8 could be confused: leave it out.
- The pictures are parts of frames of the same match: zoomed-in parts, or a frame cut into four overlapping quarters (so a player can be in two pictures). Combine them all, each number once per team.
- Ignore referees, coaches in plain clothes, the score board and numbers on the floor or walls.`;

const NUMBERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    teams: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          shirt: { type: 'string', description: 'shirt colour(s), e.g. "white with blue"' },
          side: { type: ['string', 'null'], enum: ['near', 'far', 'left', 'right', null], description: 'where the team is in the frames, if clear' },
          numbers: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: { number: { type: 'integer' }, libero: { type: 'boolean' } },
              required: ['number', 'libero'],
            },
          },
        },
        required: ['shirt', 'side', 'numbers'],
      },
    },
  },
  required: ['teams'],
};

/** Reads the shirt numbers per team from video frames (null config: disabled). */
export function makeNumberReader(env = {}, read = null) {
  const cfg = aiConfig(env, 'scan');
  const model = cfg?.model ?? (env.VISION_MODEL || 'claude-opus-5-5');
  if (read) return { enabled: true, model, read };
  if (!cfg) return { enabled: false, model, read: async () => { throw new Error('disabled'); } };
  return {
    enabled: true,
    model,
    async read(images, { onUsage = null } = {}) {
      const text = await aiComplete(cfg, {
        system: NUMBERS_SYSTEM,
        text: `List the readable shirt numbers per team in ${images.length === 1 ? 'this picture' : `these ${images.length} pictures`}.`,
        images,
        maxTokens: 1500,
        schema: NUMBERS_SCHEMA,
        jsonHint: '{"teams":[{"shirt":"white with blue","side":"near","numbers":[{"number":7,"libero":false}]}]}',
        onUsage,
      });
      return cleanNumbers(parseJson(text));
    },
  };
}

/** Only sensible numbers (0–99), each once per team, sorted; empty teams left out. */
export function cleanNumbers(data) {
  const teams = (Array.isArray(data?.teams) ? data.teams : []).map((t) => {
    const seen = new Map();
    for (const n of Array.isArray(t?.numbers) ? t.numbers : []) {
      const num = Number(n?.number);
      if (Number.isInteger(num) && num >= 0 && num <= 99) seen.set(num, (seen.get(num) ?? false) || !!n?.libero);
    }
    return {
      shirt: String(t?.shirt ?? '').slice(0, 60) || 'unknown',
      side: ['near', 'far', 'left', 'right'].includes(t?.side) ? t.side : null,
      numbers: [...seen].sort((a, b) => a[0] - b[0]).map(([number, libero]) => ({ number, libero })),
    };
  }).filter((t) => t.numbers.length);
  return { teams: teams.slice(0, 4) };
}
