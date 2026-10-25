// Reads the summary fields off a photo of an official Swiss Volley / FIVB match
// sheet with a Claude vision model, so a match can be pre-filled instead of typed.
// Disabled unless ANTHROPIC_API_KEY is set; the SDK is imported lazily so the
// server runs fine without it installed.

const SYSTEM = `You read official volleyball match sheets (Swiss Volley / FIVB "Spielberichtsbogen / Feuille de match"), handwritten or printed, and return only the clearly legible summary fields.

Layout you will see:
- Two teams, A (top-left, "A") and B. Their names are written at the top next to "Mannschaften/Equipes/Squadra".
- Header: league ("Liga/Ligue", e.g. "3.L"), match number ("Spiel Nr / Match No"), venue ("Halle/Salle"), date ("Datum/Date"), start time ("Zeit/Heure").
- Per-set score grids (the big "SATZ/SET 1..5" blocks) are hard to read point by point — DO NOT try to transcribe them.
- Final result ("Endresultat / Résultat final / Risultato finale", bottom-right): one row per set with each team's final points, and the sets won ("Gewinner/Vainqueur"). Read the per-set final points and the sets won from here.
- Team rosters (right side, "Mannschaften"): license no, jersey number and surname/first name per player. The captain is marked "C" (or a circled/underlined number), liberos are listed in a separate "LIBERO (L)" box.

Rules:
- Only report what you can read with confidence. Use null (or omit list items) for anything illegible — never guess a score or a name.
- Jersey numbers are integers. Names: keep what is written (e.g. "R. Maier", "S.Kulterer").
- sets: one object per set actually played, in order, with each team's final points (e.g. 25 and 22).
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
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['teams', 'date', 'league', 'matchNo', 'winner', 'setsWon', 'sets', 'rosters', 'confidence'],
  $defs: {
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

/** Parse the model's JSON, tolerating a ```json fence if structured output wasn't honoured. */
function parseJson(text) {
  try { return JSON.parse(text); } catch { /* try to find the JSON body */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in response');
  return JSON.parse(m[0]);
}

/**
 * Build a scanner. [scan] is injectable so tests don't call the real API.
 * env.ANTHROPIC_API_KEY enables it; env.VISION_MODEL overrides the model.
 */
export function makeVisionScanner(env = {}, scan = null) {
  const apiKey = env.ANTHROPIC_API_KEY || env.VISION_API_KEY || null;
  const model = env.VISION_MODEL || 'claude-opus-5-5';
  if (scan) return { enabled: true, model, scan };
  if (!apiKey) return { enabled: false, model, scan: async () => { throw new Error('disabled'); } };

  return {
    enabled: true,
    model,
    async scan(images) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      const content = [
        ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
        { type: 'text', text: 'Read this match sheet and return the summary fields. If several photos are given, they are pages of the same match.' },
      ];
      const resp = await client.messages.create({
        model,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      });
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return parseJson(text);
    },
  };
}

/** Validate the uploaded images array from the request body. Returns [images, error]. */
export function cleanImages(body) {
  const list = Array.isArray(body?.images) ? body.images : null;
  if (!list || !list.length) return [null, 'images required: [{ media_type, data }]'];
  if (list.length > 4) return [null, 'at most 4 pages'];
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
