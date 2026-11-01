import crypto from 'node:crypto';
import { ACTIONS, ROLES } from './actions.js';
import { requireCoach } from './auth.js';
import { MAX_EXAMPLES, MAX_TOUCHES, cleanLabel } from './touches.js';
import { cleanSheet } from './sheet.js';
import { abortUpload, completeUpload, createUpload, deleteObject, presign } from './s3.js';
import { cleanImages } from './vision.js';

function bad(reply, msg, code = 400) {
  return reply.code(code).send({ error: msg });
}

function int(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalizes an incoming event body; returns [event, error]. */
const HINTS = ['quiet', 'gap'];
/** Seconds: a suggestion this close to a saved event is the same touch. */
const DUPLICATE_WINDOW = 0.35;

function cleanEvent(body) {
  if (!ACTIONS.includes(body.action)) return [null, `Unknown action ${body.action}`];
  const value = int(body.value);
  if (value !== null && (value < 0 || value > 3)) return [null, 'value must be 0..3'];
  const zone = int(body.zone);
  if (zone !== null && (zone < 1 || zone > 6)) return [null, 'zone must be 1..6'];
  // x, y: where the ball went; fx, fy: where it was played from. Court meters, our baseline at y = 0.
  const x = num(body.x);
  const y = num(body.y);
  const fx = num(body.fx);
  const fy = num(body.fy);
  const offCourt = (a, b) => a < -6 || a > 15 || b < -6 || b > 24;
  if ((x === null) !== (y === null) || (fx === null) !== (fy === null)) return [null, 'x and y (fx and fy) go together'];
  if ((x !== null && offCourt(x, y)) || (fx !== null && offCourt(fx, fy))) return [null, 'point is off the court area'];
  return [{
    x,
    y,
    fx,
    fy,
    rally: int(body.rally),
    poss: int(body.poss),
    player_id: int(body.player_id),
    jersey: int(body.jersey),
    action: body.action,
    value,
    zone,
    t: num(body.t),
    set_no: int(body.set_no),
    source: body.source === 'auto' ? 'auto' : 'manual',
    status: body.status === 'suggested' ? 'suggested' : 'confirmed',
    confidence: num(body.confidence),
    hint: HINTS.includes(body.hint) ? body.hint : null,
    client_id: body.client_id ? String(body.client_id).slice(0, 64) : null,
  }, null];
}

export function registerRoutes(app, { db, vision, insights, touches, aiDailyLimit = 400, updates = null, budget = null, aiMonthlyBudget = null, aiCurrency = '$', storage = null, storageFetch = undefined }) {
  const q = {
    teams: db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM players p WHERE p.team_id = t.id AND p.active = 1) AS player_count
                       FROM teams t ORDER BY t.name`),
    team: db.prepare('SELECT * FROM teams WHERE id = ?'),
    players: db.prepare('SELECT * FROM players WHERE team_id = ? ORDER BY active DESC, number, name'),
    player: db.prepare('SELECT * FROM players WHERE id = ?'),
    matches: db.prepare(`SELECT m.*, t.name AS team_name,
                           (SELECT COUNT(*) FROM events e WHERE e.match_id = m.id) AS event_count,
                           (SELECT COUNT(*) FROM events e WHERE e.match_id = m.id AND e.status = 'suggested') AS suggested_count,
                           (SELECT COUNT(*) FROM events e WHERE e.match_id = m.id AND e.status = 'confirmed') AS confirmed_count,
                           (SELECT COUNT(*) FROM events e WHERE e.match_id = m.id AND e.status = 'confirmed' AND e.source = 'auto') AS auto_confirmed_count,
                           (SELECT COUNT(*) FROM edit_suggestions s WHERE s.match_id = m.id AND s.status = 'open') AS open_edits
                         FROM matches m LEFT JOIN teams t ON t.id = m.team_id
                         ORDER BY COALESCE(m.played_on, m.created_at) DESC, m.id DESC`),
    match: db.prepare('SELECT m.*, t.name AS team_name FROM matches m LEFT JOIN teams t ON t.id = m.team_id WHERE m.id = ?'),
    matchByToken: db.prepare('SELECT m.*, t.name AS team_name FROM matches m LEFT JOIN teams t ON t.id = m.team_id WHERE m.share_token = ?'),
    events: db.prepare('SELECT * FROM events WHERE match_id = ? ORDER BY COALESCE(t, 1e12), id'),
    event: db.prepare('SELECT * FROM events WHERE id = ?'),
    eventByClient: db.prepare('SELECT * FROM events WHERE match_id = ? AND client_id = ?'),
    insertEvent: db.prepare(`INSERT INTO events (match_id, player_id, jersey, action, value, zone, x, y, fx, fy, rally, poss, t, set_no, source, status, confidence, hint, client_id)
                             VALUES (@match_id, @player_id, @jersey, @action, @value, @zone, @x, @y, @fx, @fy, @rally, @poss, @t, @set_no, @source, @status, @confidence, @hint, @client_id)`),
  };

  const coach = { onRequest: requireCoach };

  function withCalibration(m) {
    return m && { ...m, calibration: m.calibration ? JSON.parse(m.calibration) : null, lineups: m.lineups ? JSON.parse(m.lineups) : null, sheet: m.sheet ? JSON.parse(m.sheet) : null };
  }

  const withAi = (e) => ({ ...e, ai: e.ai ? JSON.parse(e.ai) : null });

  function matchBundle(match) {
    const players = match.team_id ? q.players.all(match.team_id) : [];
    return { match: withCalibration(match), players, events: q.events.all(match.id).map(withAi) };
  }

  // Resolve a jersey number to a roster player of the match's team.
  function attachPlayer(match, ev) {
    if (ev.player_id || ev.jersey === null || !match.team_id) return ev;
    const p = db.prepare('SELECT id FROM players WHERE team_id = ? AND number = ? AND active = 1').get(match.team_id, ev.jersey);
    return p ? { ...ev, player_id: p.id } : ev;
  }

  // ---------- teams & players ----------
  app.get('/api/teams', coach, async () => q.teams.all());

  app.post('/api/teams', coach, async (req, reply) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return bad(reply, 'Name required');
    const r = db.prepare('INSERT INTO teams (name, coach) VALUES (?, ?)').run(name, req.body.coach ?? null);
    return q.team.get(r.lastInsertRowid);
  });

  app.get('/api/teams/:id', coach, async (req, reply) => {
    const team = q.team.get(req.params.id);
    if (!team) return bad(reply, 'Not found', 404);
    return { ...team, players: q.players.all(team.id) };
  });

  app.patch('/api/teams/:id', coach, async (req, reply) => {
    const team = q.team.get(req.params.id);
    if (!team) return bad(reply, 'Not found', 404);
    const b = req.body ?? {};
    db.prepare('UPDATE teams SET name = ?, coach = ?, show_tips = ? WHERE id = ?')
      .run(b.name ?? team.name, b.coach ?? team.coach, 'show_tips' in b ? (b.show_tips ? 1 : 0) : team.show_tips, team.id);
    return q.team.get(team.id);
  });

  app.delete('/api/teams/:id', coach, async (req) => {
    db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  app.post('/api/teams/:id/players', coach, async (req, reply) => {
    if (!q.team.get(req.params.id)) return bad(reply, 'Team not found', 404);
    const name = String(req.body?.name ?? '').trim();
    if (!name) return bad(reply, 'Name required');
    const role = ROLES.includes(req.body.role) ? req.body.role : 'OH';
    const r = db.prepare('INSERT INTO players (team_id, name, number, role) VALUES (?, ?, ?, ?)')
      .run(req.params.id, name, int(req.body.number), role);
    return q.player.get(r.lastInsertRowid);
  });

  app.patch('/api/players/:id', coach, async (req, reply) => {
    const p = q.player.get(req.params.id);
    if (!p) return bad(reply, 'Not found', 404);
    const b = req.body ?? {};
    db.prepare('UPDATE players SET name = ?, number = ?, role = ?, active = ? WHERE id = ?').run(
      b.name ?? p.name,
      'number' in b ? int(b.number) : p.number,
      ROLES.includes(b.role) ? b.role : p.role,
      'active' in b ? (b.active ? 1 : 0) : p.active,
      p.id,
    );
    return q.player.get(p.id);
  });

  app.delete('/api/players/:id', coach, async (req) => {
    // Keep history: deactivate players who already have events.
    const used = db.prepare('SELECT 1 FROM events WHERE player_id = ? LIMIT 1').get(req.params.id);
    if (used) db.prepare('UPDATE players SET active = 0 WHERE id = ?').run(req.params.id);
    else db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // ---------- matches ----------
  app.get('/api/matches', coach, async () => q.matches.all());

  app.post('/api/matches', coach, async (req, reply) => {
    const b = req.body ?? {};
    const label = String(b.label ?? '').trim();
    if (!label) return bad(reply, 'Label required');
    const r = db.prepare(`INSERT INTO matches (team_id, label, opponent, played_on, mode, video_type, video_ref)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      int(b.team_id), label, b.opponent ?? null, b.played_on ?? null,
      b.mode === 'live' ? 'live' : 'video', b.video_type ?? null, b.video_ref ?? null,
    );
    return q.match.get(r.lastInsertRowid);
  });

  app.get('/api/matches/:id', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Not found', 404);
    return matchBundle(match);
  });

  app.patch('/api/matches/:id', coach, async (req, reply) => {
    const m = q.match.get(req.params.id);
    if (!m) return bad(reply, 'Not found', 404);
    const b = req.body ?? {};
    const pick = (k) => (k in b ? b[k] : m[k]);
    let calibration = m.calibration;
    if ('calibration' in b) {
      const c = b.calibration;
      const inImage = (v) => Number.isFinite(v) && v >= -0.5 && v <= 1.5;
      const onCourt = (v) => Number.isFinite(v) && v >= -5 && v <= 23;
      // New format: 4-10 tapped landmarks {id, u, v, x, y}; legacy: 4 corners [u, v].
      const validPoints = (pts) => Array.isArray(pts) && pts.length >= 4 && pts.length <= 10
        && pts.every((p) => typeof p?.id === 'string' && p.id.length <= 16 && inImage(p.u) && inImage(p.v) && onCourt(p.x) && onCourt(p.y));
      const cleanPoints = (pts) => pts.map(({ id, u, v, x, y }) => ({ id, u, v, x, y }));
      const half = (h) => ['near', 'far'].includes(h);
      const points = validPoints(c?.points);
      const corners = Array.isArray(c?.corners) && c.corners.length === 4
        && c.corners.every((p) => Array.isArray(p) && p.length === 2 && p.every(inImage));
      // Side switches (one per set): from video time t we play on ourHalf, optionally with a new court marking.
      const switches = c?.switches ?? [];
      const switchesOk = Array.isArray(switches) && switches.length <= 10 && switches.every((sw) =>
        Number.isFinite(sw?.t) && sw.t >= 0 && half(sw.ourHalf) && (sw.points == null || validPoints(sw.points)));
      const valid = c === null || ((points || corners) && half(c.ourHalf) && switchesOk);
      if (!valid) return bad(reply, 'calibration needs 4-10 points {id, u, v, x, y} (or 4 corners), ourHalf near|far and at most 10 side switches {t, ourHalf, points?}');
      calibration = c === null ? null : JSON.stringify({
        ...(points ? { points: cleanPoints(c.points) } : { corners: c.corners }),
        ourHalf: c.ourHalf,
        ...(switches.length ? {
          switches: switches.map((sw) => ({ t: sw.t, ourHalf: sw.ourHalf, ...(sw.points ? { points: cleanPoints(sw.points) } : {}) })),
        } : {}),
      });
    }
    let lineups = m.lineups;
    if ('lineups' in b) {
      const l = b.lineups;
      const id = (v) => v === null || Number.isInteger(v);
      const ok = l === null || (typeof l === 'object' && !Array.isArray(l) && Object.entries(l).length <= 5 && Object.entries(l).every(([k, v]) =>
        /^[1-5]$/.test(k) && Array.isArray(v?.order) && v.order.length === 6 && v.order.every(id) && id(v.libero ?? null) && typeof v.weServeFirst === 'boolean'
        && (v.subs == null || (Array.isArray(v.subs) && v.subs.length <= 30
          && v.subs.every((x) => Number.isFinite(x?.t) && x.t >= 0 && Number.isInteger(x.out) && Number.isInteger(x.in))))));
      if (!ok) return bad(reply, 'lineups: { "1".."5": { order: [6 player ids or null], libero, weServeFirst, subs?: [{ t, out, in }] } }');
      lineups = l === null ? null : JSON.stringify(Object.fromEntries(Object.entries(l).map(([k, v]) =>
        [k, {
          order: v.order, libero: v.libero ?? null, weServeFirst: v.weServeFirst,
          ...(v.subs?.length ? { subs: v.subs.map((x) => ({ t: x.t, out: x.out, in: x.in })) } : {}),
        }])));
    }
    let sheet = m.sheet;
    if ('sheet' in b) {
      const clean = b.sheet === null ? null : cleanSheet(b.sheet);
      if (b.sheet !== null && !clean) return bad(reply, 'sheet: { ourTeam: "A" | "B", sets, flow }');
      sheet = clean && JSON.stringify(clean);
    }
    db.prepare(`UPDATE matches SET team_id = ?, label = ?, opponent = ?, played_on = ?, mode = ?, video_type = ?, video_ref = ?, calibration = ?, lineups = ?, sheet = ? WHERE id = ?`)
      .run(int(pick('team_id')), pick('label'), pick('opponent'), pick('played_on'), pick('mode'), pick('video_type'), pick('video_ref'), calibration, lineups, sheet, m.id);
    return withCalibration(q.match.get(m.id));
  });

  app.delete('/api/matches/:id', coach, async (req) => {
    db.prepare('DELETE FROM matches WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  app.post('/api/matches/:id/share', coach, async (req, reply) => {
    const m = q.match.get(req.params.id);
    if (!m) return bad(reply, 'Not found', 404);
    const token = req.body?.revoke ? null : (m.share_token ?? crypto.randomBytes(12).toString('base64url'));
    db.prepare('UPDATE matches SET share_token = ? WHERE id = ?').run(token, m.id);
    return { share_token: token };
  });

  app.get('/api/share/:token', async (req, reply) => {
    const match = q.matchByToken.get(req.params.token);
    if (!match) return bad(reply, 'Not found', 404);
    const bundle = matchBundle(match);
    return { ...bundle, events: bundle.events.filter((e) => e.status === 'confirmed').map(({ ai: _ai, ...e }) => e) };
  });

  app.post('/api/teams/:id/share', coach, async (req, reply) => {
    const t = q.team.get(req.params.id);
    if (!t) return bad(reply, 'Not found', 404);
    const token = req.body?.revoke ? null : (t.share_token ?? crypto.randomBytes(12).toString('base64url'));
    db.prepare('UPDATE teams SET share_token = ? WHERE id = ?').run(token, t.id);
    return { share_token: token };
  });

  // Public season report: confirmed tags only; no tokens leak out.
  app.get('/api/share/team/:token', async (req, reply) => {
    const team = db.prepare('SELECT id, name, show_tips FROM teams WHERE share_token = ?').get(req.params.token);
    if (!team) return bad(reply, 'Not found', 404);
    // The court marking goes along so the Replays tab draws the court the way the camera sees it.
    const matches = db.prepare('SELECT id, label, opponent, played_on, sheet, calibration, video_type, video_ref, video_key FROM matches WHERE team_id = ? ORDER BY played_on, id').all(team.id)
      // Which video to load for the Replays tab: a YouTube id, or the file name of the coach's copy (never the file).
      .map(({ video_type, video_ref, video_key, ...m }) => ({
        ...m,
        video: video_key && storage ? { type: 'hosted' } : video_type === 'youtube' && video_ref ? { type: 'youtube', id: video_ref } : video_ref ? { type: 'file', name: video_ref } : null,
      }));
    const events = db.prepare(`SELECT e.id, e.match_id, e.player_id, e.jersey, e.action, e.value, e.zone, e.x, e.y, e.fx, e.fy, e.rally, e.poss, e.t, e.set_no, e.status
                               FROM events e JOIN matches m ON m.id = e.match_id
                               WHERE m.team_id = ? AND e.status = 'confirmed'`).all(team.id);
    return { team, players: q.players.all(team.id), matches: matches.map(withCalibration), events };
  });

  // ---------- corrections from viewers of the public link ----------
  const EDIT_FIELDS = ['action', 'value', 'player_id', 'x', 'y', 'fx', 'fy'];
  const editRate = new Map();   // ip -> { hour, n }: at most 60 suggestions an hour per address
  app.post('/api/share/team/:token/edits', async (req, reply) => {
    const team = db.prepare('SELECT id FROM teams WHERE share_token = ?').get(req.params.token);
    if (!team) return bad(reply, 'Not found', 404);
    const sender = int(req.body?.jersey);
    if (sender == null || sender < 0 || sender > 99) return bad(reply, 'Your shirt number is required (0-99)');
    const hour = Math.floor(Date.now() / 3600e3);
    const r = editRate.get(req.ip);
    if (r?.hour === hour && r.n >= 60) return bad(reply, 'Too many suggestions for now; try again later.', 429);
    editRate.set(req.ip, { hour, n: r?.hour === hour ? r.n + 1 : 1 });
    if (db.prepare("SELECT COUNT(*) AS n FROM edit_suggestions WHERE team_id = ? AND status = 'open'").get(team.id).n >= 500) {
      return bad(reply, 'Too many open suggestions; try again later.', 429);
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
    const save = (kind, matchId, eventId, changes, original) => Number(db.prepare(`INSERT INTO edit_suggestions (team_id, match_id, event_id, changes, original, note, name, sender_jersey, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(team.id, matchId, eventId, JSON.stringify(changes), JSON.stringify(original), note || null, name || null, sender, kind).lastInsertRowid);

    // A touch that is not tagged at all (e.g. a block without a touch), at a video time.
    if (req.body?.kind === 'add') {
      const match = db.prepare('SELECT id FROM matches WHERE id = ? AND team_id = ?').get(int(req.body?.match_id), team.id);
      if (!match) return bad(reply, 'Match not found', 404);
      const t = num(req.body?.t);
      if (t == null || t < 0 || t > 6 * 3600) return bad(reply, 'video time required');
      // The set from the tags nearest in time.
      const near = db.prepare("SELECT set_no FROM events WHERE match_id = ? AND t IS NOT NULL AND status = 'confirmed' ORDER BY ABS(t - ?) LIMIT 1").get(match.id, t);
      const raw = req.body?.changes && typeof req.body.changes === 'object' ? req.body.changes : {};
      const [clean, err] = cleanEvent({ ...Object.fromEntries(EDIT_FIELDS.filter((k) => k in raw).map((k) => [k, raw[k]])), t, set_no: near?.set_no ?? 1 });
      if (err) return bad(reply, err);
      if (clean.player_id != null && !db.prepare('SELECT 1 FROM players WHERE id = ? AND team_id = ?').get(clean.player_id, team.id)) return bad(reply, 'Unknown player');
      const changes = { ...Object.fromEntries(EDIT_FIELDS.map((k) => [k, clean[k]])), t: clean.t, set_no: clean.set_no };
      return { id: save('add', match.id, null, changes, {}) };
    }

    const ev = db.prepare(`SELECT e.* FROM events e JOIN matches m ON m.id = e.match_id WHERE e.id = ? AND m.team_id = ? AND e.status = 'confirmed'`)
      .get(int(req.body?.event_id), team.id);
    if (!ev) return bad(reply, 'Tag not found', 404);
    const raw = req.body?.changes && typeof req.body.changes === 'object' ? req.body.changes : {};
    // Checked like a tag: the tag with the changes must still be a valid tag.
    const proposed = Object.fromEntries(EDIT_FIELDS.filter((k) => k in raw).map((k) => [k, raw[k]]));
    const [clean, err] = cleanEvent({ ...ev, ...proposed });
    if (err) return bad(reply, err);
    if (clean.player_id != null && !db.prepare('SELECT 1 FROM players WHERE id = ? AND team_id = ?').get(clean.player_id, team.id)) return bad(reply, 'Unknown player');
    const changes = Object.fromEntries(EDIT_FIELDS.filter((k) => k in proposed && clean[k] !== ev[k]).map((k) => [k, clean[k]]));
    if (!Object.keys(changes).length && !note) return bad(reply, 'Nothing changed');
    const original = Object.fromEntries(EDIT_FIELDS.map((k) => [k, ev[k]]));
    return { id: save('edit', ev.match_id, ev.id, changes, original) };
  });

  const editRow = (s) => ({ ...s, changes: JSON.parse(s.changes), original: JSON.parse(s.original) });
  app.get('/api/edits', coach, async (req) => {
    const status = ['open', 'accepted', 'rejected'].includes(req.query.status) ? req.query.status : 'open';
    const match = int(req.query.match_id);
    const rows = db.prepare(`SELECT s.*, m.label AS match_label FROM edit_suggestions s JOIN matches m ON m.id = s.match_id
                             WHERE s.status = ? ${match ? 'AND s.match_id = ?' : ''} ORDER BY s.id DESC LIMIT 500`).all(...(match ? [status, match] : [status]));
    // With the tag as it is now, to show what would change (and whether it changed since).
    return rows.map((s) => ({ ...editRow(s), event: s.event_id ? q.event.get(s.event_id) ?? null : null }));
  });

  app.post('/api/edits/:id/:decision', coach, async (req, reply) => {
    const s = db.prepare("SELECT * FROM edit_suggestions WHERE id = ? AND status = 'open'").get(req.params.id);
    if (!s) return bad(reply, 'Not found', 404);
    const decision = req.params.decision;
    if (!['accept', 'reject'].includes(decision)) return bad(reply, 'accept or reject');
    let event = null;
    if (decision === 'accept' && s.kind === 'add') {
      const match = q.match.get(s.match_id);
      const [ev, err] = cleanEvent({ ...JSON.parse(s.changes), status: 'confirmed' });
      if (err || !match) return bad(reply, err ?? 'Match not found');
      const p = ev.player_id != null ? q.player.get(ev.player_id) : null;
      const r = q.insertEvent.run({ ...ev, jersey: p?.number ?? null, source: 'manual', match_id: match.id });
      event = q.event.get(r.lastInsertRowid);
      db.prepare('UPDATE edit_suggestions SET event_id = ? WHERE id = ?').run(event.id, s.id);
    } else if (decision === 'accept') {
      const cur = s.event_id ? q.event.get(s.event_id) : null;
      if (!cur) return bad(reply, 'The tag was deleted since', 409);
      const [ev, err] = cleanEvent({ ...cur, ...JSON.parse(s.changes) });
      if (err) return bad(reply, err);
      const p = ev.player_id != null ? q.player.get(ev.player_id) : null;
      db.prepare('UPDATE events SET player_id = ?, jersey = ?, action = ?, value = ?, x = ?, y = ?, fx = ?, fy = ? WHERE id = ?')
        .run(ev.player_id, p ? p.number : ev.player_id == null ? cur.jersey : ev.jersey, ev.action, ev.value, ev.x, ev.y, ev.fx, ev.fy, cur.id);
      event = q.event.get(cur.id);
    }
    db.prepare("UPDATE edit_suggestions SET status = ?, decided_at = datetime('now') WHERE id = ?").run(decision === 'accept' ? 'accepted' : 'rejected', s.id);
    return { ok: true, event };
  });

  // Season / multi-match report: all confirmed events for a team.
  app.get('/api/teams/:id/report', coach, async (req, reply) => {
    const team = q.team.get(req.params.id);
    if (!team) return bad(reply, 'Not found', 404);
    const matches = db.prepare('SELECT * FROM matches WHERE team_id = ? ORDER BY played_on, id').all(team.id);
    const events = db.prepare(`SELECT e.* FROM events e JOIN matches m ON m.id = e.match_id
                               WHERE m.team_id = ? AND e.status = 'confirmed'`).all(team.id).map(({ ai: _ai, ...e }) => e);
    return { team, players: q.players.all(team.id), matches: matches.map(withCalibration), events };
  });

  // ---------- events ----------
  app.post('/api/matches/:id/events', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const [ev, err] = cleanEvent(req.body ?? {});
    if (err) return bad(reply, err);
    // Idempotent for the offline outbox: retries with the same client_id return the original.
    if (ev.client_id) {
      const existing = q.eventByClient.get(match.id, ev.client_id);
      if (existing) return existing;
    }
    const r = q.insertEvent.run({ ...attachPlayer(match, ev), match_id: match.id });
    return q.event.get(r.lastInsertRowid);
  });

  app.patch('/api/events/:id', coach, async (req, reply) => {
    const cur = q.event.get(req.params.id);
    if (!cur) return bad(reply, 'Not found', 404);
    const merged = { ...cur, ...req.body };
    const [ev, err] = cleanEvent(merged);
    if (err) return bad(reply, err);
    // An auto suggestion given another player or action counts as a correction (accuracy metric).
    if (cur.source === 'auto' && cur.status === 'suggested' && ((ev.player_id ?? null) !== (cur.player_id ?? null) || ev.action !== cur.action)) {
      db.prepare('UPDATE matches SET edited_count = edited_count + 1 WHERE id = ?').run(cur.match_id);
    }
    db.prepare(`UPDATE events SET player_id = @player_id, jersey = @jersey, action = @action, value = @value, zone = @zone, x = @x, y = @y,
                fx = @fx, fy = @fy, rally = @rally, poss = @poss, t = @t, set_no = @set_no, status = @status, confidence = @confidence WHERE id = @id`)
      .run({ ...ev, source: cur.source, id: cur.id });
    return q.event.get(cur.id);
  });

  // Removing an auto suggestion counts it as a false detection.
  const countRemoved = (ev) => {
    if (ev?.source === 'auto' && ev.status === 'suggested') db.prepare('UPDATE matches SET removed_count = removed_count + 1 WHERE id = ?').run(ev.match_id);
  };

  app.delete('/api/events/:id', coach, async (req) => {
    db.transaction(() => {
      countRemoved(q.event.get(req.params.id));
      db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    })();
    return { ok: true };
  });

  // Active analyst time, sent by the page in small increments while someone works on the match.
  app.post('/api/matches/:id/work', coach, async (req, reply) => {
    const sec = Math.round(Number(req.body?.sec));
    if (!Number.isFinite(sec) || sec < 0 || sec > 600) return bad(reply, 'sec must be 0-600');
    const r = db.prepare('UPDATE matches SET work_sec = work_sec + ? WHERE id = ?').run(sec, req.params.id);
    if (!r.changes) return bad(reply, 'Not found', 404);
    return { work_sec: q.match.get(req.params.id).work_sec };
  });

  app.post('/api/matches/:id/events/bulk', coach, async (req, reply) => {
    const { op, ids } = req.body ?? {};
    if (!Array.isArray(ids)) return bad(reply, 'ids required');
    const run = db.transaction(() => {
      for (const id of ids) {
        if (op === 'confirm') db.prepare("UPDATE events SET status = 'confirmed' WHERE id = ? AND match_id = ?").run(id, req.params.id);
        else if (op === 'delete') {
          const ev = q.event.get(id);
          if (ev && String(ev.match_id) === String(req.params.id)) countRemoved(ev);
          db.prepare('DELETE FROM events WHERE id = ? AND match_id = ?').run(id, req.params.id);
        }
      }
    });
    run();
    return { ok: true };
  });

  // ---------- match sheet scan (optional, needs ANTHROPIC_API_KEY) ----------
  app.get('/api/matchsheet/enabled', coach, async () => ({ enabled: !!vision?.enabled }));

  app.post('/api/matchsheet/scan', coach, async (req, reply) => {
    if (!vision?.enabled) return bad(reply, 'Match-sheet scanning is not set up on this server (needs an AI backend: LiteLLM or Anthropic).', 503);
    const [images, err] = cleanImages(req.body);
    if (err) return bad(reply, err);
    try {
      const data = await vision.scan(images, { onUsage: usage('scan', vision.model, images.length) });
      return { data };
    } catch (e) {
      req.log?.error({ err: e }, 'match sheet scan failed');
      return bad(reply, 'Could not read the match sheet. Try a sharper, straight-on photo.', 502);
    }
  });

  app.get('/api/insights/enabled', coach, async () => ({ enabled: !!insights?.enabled }));

  app.post('/api/insights/summary', coach, async (req, reply) => {
    if (!insights?.enabled) return bad(reply, 'AI insights are not set up on this server (needs an AI backend: LiteLLM or Anthropic).', 503);
    const stats = req.body?.stats;
    const lang = req.body?.lang === 'de' ? 'de' : 'en';
    if (!stats || typeof stats !== 'object') return bad(reply, 'stats object required');
    if (JSON.stringify(stats).length > 60000) return bad(reply, 'stats too large');
    try {
      const bullets = await insights.generate(stats, lang, { onUsage: usage('summary', insights.model, 1) });
      return { bullets };
    } catch (e) {
      req.log?.error({ err: e }, 'insights failed');
      return bad(reply, 'Could not generate the summary. Try again.', 502);
    }
  });

  // ---------- AI check of detected touches (optional) ----------
  // A cap on AI calls per day, so a bug or a stuck button cannot use up the credits.
  const aiUse = { day: '', n: 0 };
  const today = () => new Date().toISOString().slice(0, 10);
  const aiLeftToday = () => {
    if (aiUse.day !== today()) { aiUse.day = today(); aiUse.n = 0; }
    return Math.max(0, aiDailyLimit - aiUse.n);
  };
  const aiAllowed = () => {
    if (aiLeftToday() === 0) return false;
    aiUse.n++;
    return true;
  };
  const addUsage = db.prepare('INSERT INTO ai_usage (task, model, items, cost, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?)');
  /** Records what one AI call cost (as reported by the gateway). */
  const usage = (task, model, items) => (u) => addUsage.run(task, model ?? null, items, u.cost ?? null, u.tokensIn ?? null, u.tokensOut ?? null);

  app.get('/api/ai/touches/enabled', coach, async () => ({ enabled: !!touches?.enabled, model: touches?.model ?? null }));

  app.post('/api/ai/touches', coach, async (req, reply) => {
    if (!touches?.enabled) return bad(reply, 'The AI touch check is not set up on this server (needs an AI backend: LiteLLM or Anthropic).', 503);
    const list = Array.isArray(req.body?.images) ? req.body.images : null;
    if (!list?.length) return bad(reply, 'images required: one per touch');
    if (list.length > MAX_TOUCHES) return bad(reply, `at most ${MAX_TOUCHES} touches per request`);
    const images = [];
    for (const im of list) {
      if (!im || !['image/jpeg', 'image/png', 'image/webp'].includes(im.media_type) || typeof im.data !== 'string' || im.data.length > 700_000) {
        return bad(reply, 'each image: jpeg/png/webp, base64, under ~500 KB');
      }
      images.push({ media_type: im.media_type, data: im.data });
    }
    const ourSide = ['near', 'far'].includes(req.body?.ourSide) ? req.body.ourSide : null;
    const roster = (Array.isArray(req.body?.roster) ? req.body.roster : []).slice(0, 30)
      .filter((p) => Number.isInteger(p?.number)).map((p) => ({ number: p.number, role: typeof p.role === 'string' ? p.role.slice(0, 4) : null }));
    if (!aiAllowed()) return bad(reply, `Daily AI limit reached (${aiDailyLimit} checks). Raise AI_DAILY_LIMIT in .env if needed.`, 429);
    const examples = req.body?.examples ? pickExamples() : [];
    try {
      return { touches: await touches.check(images, { ourSide, roster }, { examples, onUsage: (count) => usage('touches', touches.model, count) }), examples: examples.length };
    } catch (e) {
      req.log?.error({ err: e }, 'touch check failed');
      return bad(reply, `AI check failed: ${String(e?.message ?? e).slice(0, 200)}`, 502);
    }
  });

  // The AI's answers per touch, kept with the suggestion until the rally is reviewed.
  app.post('/api/matches/:id/ai', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const list = Array.isArray(req.body?.results) ? req.body.results.slice(0, 2000) : null;
    if (!list) return bad(reply, 'results required');
    const set = db.prepare('UPDATE events SET ai = ? WHERE id = ? AND match_id = ?');
    let n = 0;
    db.transaction(() => {
      for (const r of list) {
        if (!Number.isInteger(r?.id)) continue;
        const ai = r.ai && typeof r.ai === 'object' ? JSON.stringify(r.ai).slice(0, 2000) : null;
        n += set.run(ai, r.id, match.id).changes;
      }
    })();
    return { updated: n };
  });

  // ---------- how well the AI does, and examples to learn from ----------
  const AI_FIELDS = ['contact', 'team', 'action', 'jersey', 'position'];
  app.post('/api/ai/feedback', coach, async (req, reply) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : null;
    if (!items) return bad(reply, 'items required');
    const ins = db.prepare('INSERT INTO ai_feedback (field, confidence, correct) VALUES (?, ?, ?)');
    let n = 0;
    db.transaction(() => {
      for (const it of items) {
        if (!AI_FIELDS.includes(it?.field) || typeof it.correct !== 'boolean') continue;
        const c = Number(it.confidence);
        ins.run(it.field, Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : null, it.correct ? 1 : 0);
        n++;
      }
      // The recent past is what counts (models and cameras change); keep it small.
      db.prepare('DELETE FROM ai_feedback WHERE id <= (SELECT MAX(id) FROM ai_feedback) - 5000').run();
    })();
    return { saved: n };
  });

  /** Per field, over its last 300 answers: how many were right, overall and when the AI was sure. */
  function aiStats() {
    const fields = {};
    for (const f of AI_FIELDS) {
      const rows = db.prepare('SELECT confidence, correct FROM ai_feedback WHERE field = ? ORDER BY id DESC LIMIT 300').all(f);
      const sure = rows.filter((r) => (r.confidence ?? 0) >= 0.6);
      fields[f] = { n: rows.length, correct: rows.filter((r) => r.correct).length, sureN: sure.length, sureCorrect: sure.filter((r) => r.correct).length };
    }
    return fields;
  }
  app.get('/api/ai/stats', coach, async () => ({
    fields: aiStats(),
    examples: db.prepare('SELECT COUNT(*) AS n FROM ai_examples').get().n,
  }));

  const MAX_STORED_EXAMPLES = 12;
  app.post('/api/ai/examples', coach, async (req, reply) => {
    const image = req.body?.image;
    const label = cleanLabel(req.body?.label);
    if (typeof image !== 'string' || image.length > 700_000 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return bad(reply, 'image: base64 JPEG under ~500 KB');
    if (!label) return bad(reply, 'label required');
    db.prepare('INSERT INTO ai_examples (image, label) VALUES (?, ?)').run(image, JSON.stringify(label));
    db.prepare('DELETE FROM ai_examples WHERE id NOT IN (SELECT id FROM ai_examples ORDER BY id DESC LIMIT ?)').run(MAX_STORED_EXAMPLES);
    return { ok: true };
  });
  app.delete('/api/ai/examples', coach, async () => ({ deleted: db.prepare('DELETE FROM ai_examples').run().changes }));

  /** Up to MAX_EXAMPLES recent examples, of different actions where possible. */
  function pickExamples() {
    const rows = db.prepare('SELECT image, label FROM ai_examples ORDER BY id DESC').all().map((r) => ({ image: r.image, label: JSON.parse(r.label) }));
    const out = [], seen = new Set();
    for (const r of rows) {
      const k = r.label.contact === 'no' ? 'none' : r.label.action;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= MAX_EXAMPLES) return out;
    }
    for (const r of rows) { if (out.length >= MAX_EXAMPLES) break; if (!out.includes(r)) out.push(r); }
    return out;
  }

  // ---------- AI credit: what is left, and what a check costs ----------
  let keyCache = { at: 0, info: null };
  app.get('/api/ai/budget', coach, async () => {
    if (budget && Date.now() - keyCache.at > 60_000) keyCache = { at: Date.now(), info: await budget().catch(() => null) };
    const key = keyCache.info;
    const month = db.prepare("SELECT COALESCE(SUM(cost), 0) AS cost, COUNT(cost) AS priced, COUNT(*) AS calls FROM ai_usage WHERE created_at >= datetime('now', 'start of month')").get();
    const per = db.prepare("SELECT SUM(cost) AS cost, SUM(items) AS items FROM (SELECT cost, items FROM ai_usage WHERE task = 'touches' AND cost IS NOT NULL ORDER BY id DESC LIMIT 50)").get();
    const spend = key?.spend ?? (month.priced ? month.cost : null);
    const max = key?.max ?? aiMonthlyBudget;
    return {
      currency: aiCurrency,
      source: key?.spend != null ? 'gateway' : month.priced ? 'server' : null,
      spend,
      max,
      remaining: spend != null && max != null ? Math.max(0, max - spend) : null,
      resetAt: key?.resetAt ?? null,
      monthCalls: month.calls,
      /** Average cost of checking one touch, from the last checks that reported a cost. */
      perTouch: per.items ? per.cost / per.items : null,
      today: { used: aiDailyLimit - aiLeftToday(), limit: aiDailyLimit },
      maxTouches: MAX_TOUCHES,
      maxExamples: MAX_EXAMPLES,
    };
  });

  // Delete every unreviewed auto suggestion of a match (saved/confirmed touches are kept),
  // to clear the review queue before re-running the detection.
  app.post('/api/matches/:id/suggestions/clear', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const r = db.prepare("DELETE FROM events WHERE match_id = ? AND source = 'auto' AND status = 'suggested'").run(match.id);
    return { deleted: r.changes };
  });

  // ---------- auto-detection results from the phone app ----------
  // The Android app analyses the video on the phone and posts its suggestions here.
  app.post('/api/matches/:id/suggestions', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const { events = [], replace = true, params = null } = req.body ?? {};
    if (!Array.isArray(events) || events.length > 10000) return bad(reply, 'events must be an array (max 10000)');
    // The run as detected (also the touches skipped below as already saved: those are hits).
    const RUN_KEYS = ['t', 'action', 'rally', 'poss', 'jersey', 'confidence', 'hint', 'set_no'];
    const runEvents = events.map((raw) => cleanEvent({ ...raw, source: 'auto', status: 'suggested', client_id: null })[0])
      .filter((ev) => ev && ev.t != null).map((ev) => Object.fromEntries(RUN_KEYS.map((k) => [k, ev[k]])));
    const save = db.transaction(() => {
      if (runEvents.length) {
        const p = params && typeof params === 'object' ? JSON.stringify(params).slice(0, 2000) : null;
        db.prepare('INSERT INTO detection_runs (match_id, params, events) VALUES (?, ?, ?)').run(match.id, p, JSON.stringify(runEvents));
        db.prepare('DELETE FROM detection_runs WHERE match_id = ? AND id NOT IN (SELECT id FROM detection_runs WHERE match_id = ? ORDER BY id DESC LIMIT 10)').run(match.id, match.id);
      }
      // Only unconfirmed auto suggestions are replaced; confirmed tags are never touched.
      if (replace) db.prepare("DELETE FROM events WHERE match_id = ? AND source = 'auto' AND status = 'suggested'").run(match.id);
      // A new run skips touches already saved (reviewed or tagged), so it only brings back what is missing.
      const saved = db.prepare("SELECT t FROM events WHERE match_id = ? AND status = 'confirmed' AND t IS NOT NULL ORDER BY t").all(match.id).map((r) => r.t);
      const isSaved = (t) => {
        let lo = 0, hi = saved.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (saved[mid] < t) lo = mid + 1; else hi = mid; }
        return [lo - 1, lo].some((i) => i >= 0 && i < saved.length && Math.abs(saved[i] - t) < DUPLICATE_WINDOW);
      };
      let n = 0;
      for (const raw of events) {
        const [ev] = cleanEvent({ ...raw, source: 'auto', status: 'suggested', client_id: null });
        if (!ev || (ev.t != null && isSaved(ev.t))) continue;
        q.insertEvent.run({ ...attachPlayer(match, ev), match_id: match.id });
        n++;
      }
      return n;
    });
    return { inserted: save() };
  });

  // ---------- match video in the bucket (optional, S3_* in .env) ----------
  // The app uploads straight into the bucket in parts; the server only signs. Viewers get
  // a link that expires. Nothing of the video passes through or stays on this server.
  const PART = 16 * 1024 * 1024;
  const MAX_VIDEO = 20 * 1024 ** 3;
  const sOpts = storageFetch ? { fetchFn: storageFetch } : {};
  const noStorage = (reply) => bad(reply, 'Video storage is not set up on this server (S3_* in .env).', 503);
  const keyOf = (match, uploadKey) => typeof uploadKey === 'string' && uploadKey.startsWith(`matches/${match.id}/`) && uploadKey.length < 200 ? uploadKey : null;

  app.get('/api/video/enabled', coach, async () => ({ enabled: !!storage, partSize: PART }));

  app.post('/api/matches/:id/video/upload', coach, async (req, reply) => {
    if (!storage) return noStorage(reply);
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const size = int(req.body?.size);
    if (!size || size <= 0 || size > MAX_VIDEO) return bad(reply, 'size required (up to 20 GB)');
    const ext = String(req.body?.name ?? '').toLowerCase().match(/\.(mp4|mov|m4v|webm|mkv)$/)?.[1] ?? 'mp4';
    const key = `matches/${match.id}/${crypto.randomBytes(9).toString('base64url')}.${ext}`;
    try {
      const uploadId = await createUpload(storage, key, sOpts);
      return { key, uploadId, partSize: PART, parts: Math.ceil(size / PART) };
    } catch (e) {
      return bad(reply, `Could not start the upload: ${e.message}`, 502);
    }
  });

  // Presigned URLs for the parts still to send (an upload can resume after a break).
  app.post('/api/matches/:id/video/parts', coach, async (req, reply) => {
    if (!storage) return noStorage(reply);
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const key = keyOf(match, req.body?.key);
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId : null;
    const parts = (Array.isArray(req.body?.parts) ? req.body.parts : []).map(int).filter((n) => n >= 1 && n <= 10000).slice(0, 50);
    if (!key || !uploadId || !parts.length) return bad(reply, 'key, uploadId and parts required');
    return { urls: Object.fromEntries(parts.map((n) => [n, presign(storage, 'PUT', key, { query: { partNumber: n, uploadId }, expires: 3600 })])) };
  });

  app.post('/api/matches/:id/video/complete', coach, async (req, reply) => {
    if (!storage) return noStorage(reply);
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const key = keyOf(match, req.body?.key);
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId : null;
    const parts = (Array.isArray(req.body?.parts) ? req.body.parts : []).filter((p) => int(p?.n) >= 1 && typeof p?.etag === 'string').map((p) => ({ n: int(p.n), etag: p.etag.slice(0, 100) }));
    if (!key || !uploadId || !parts.length) return bad(reply, 'key, uploadId and parts required');
    try {
      await completeUpload(storage, key, uploadId, parts, sOpts);
    } catch (e) {
      return bad(reply, `Could not finish the upload: ${e.message}`, 502);
    }
    // The previous video of this match (and its smaller versions) goes.
    if (match.video_key && match.video_key !== key) await deleteObject(storage, match.video_key, sOpts).catch(() => {});
    await dropVariants(match);
    db.prepare('UPDATE matches SET video_key = ?, video_bytes = ?, video_variants = NULL WHERE id = ?').run(key, int(req.body?.size), match.id);
    // The transcoder service makes the 720p and 480p versions.
    db.prepare("DELETE FROM video_jobs WHERE match_id = ? AND state != 'running'").run(match.id);
    db.prepare('INSERT INTO video_jobs (match_id, source_key) VALUES (?, ?)').run(match.id, key);
    return { ok: true };
  });

  app.post('/api/matches/:id/video/abort', coach, async (req, reply) => {
    if (!storage) return noStorage(reply);
    const match = q.match.get(req.params.id);
    const key = match && keyOf(match, req.body?.key);
    if (!key || typeof req.body?.uploadId !== 'string') return bad(reply, 'key and uploadId required');
    await abortUpload(storage, key, req.body.uploadId, sOpts).catch(() => {});
    return { ok: true };
  });

  app.delete('/api/matches/:id/video', coach, async (req, reply) => {
    if (!storage) return noStorage(reply);
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    if (match.video_key) {
      try { await deleteObject(storage, match.video_key, sOpts); } catch (e) { return bad(reply, `Could not delete: ${e.message}`, 502); }
    }
    await dropVariants(match);
    db.prepare('UPDATE matches SET video_key = NULL, video_bytes = NULL, video_variants = NULL WHERE id = ?').run(match.id);
    db.prepare("DELETE FROM video_jobs WHERE match_id = ? AND state != 'running'").run(match.id);
    return { ok: true };
  });

  /** The smaller versions of a match's video ({ '720': {key, bytes}, '480': ... }). */
  const variantsOf = (m) => { try { return m?.video_variants ? JSON.parse(m.video_variants) : {}; } catch { return {}; } };
  async function dropVariants(m) {
    for (const v of Object.values(variantsOf(m))) await deleteObject(storage, v.key, sOpts).catch(() => {});
  }
  /** Links to stream the video, valid for 6 hours: the original and each smaller version. */
  const videoLink = (m) => ({
    url: presign(storage, 'GET', m.video_key, { expires: 6 * 3600 }),
    expiresIn: 6 * 3600,
    variants: Object.fromEntries(Object.entries(variantsOf(m)).map(([q, v]) => [q, presign(storage, 'GET', v.key, { expires: 6 * 3600 })])),
  });
  app.get('/api/matches/:id/video/url', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!storage || !match?.video_key) return bad(reply, 'No video in the cloud for this match', 404);
    return videoLink(match);
  });
  /** The conversion into smaller versions: queued, running (with progress), done or failed. */
  app.get('/api/matches/:id/video/status', coach, async (req) => {
    const job = db.prepare('SELECT state, progress, error, updated_at FROM video_jobs WHERE match_id = ? ORDER BY id DESC LIMIT 1').get(req.params.id);
    const ahead = job?.state === 'queued' ? db.prepare("SELECT COUNT(*) AS n FROM video_jobs WHERE state IN ('queued', 'running') AND id < (SELECT MAX(id) FROM video_jobs WHERE match_id = ?)").get(req.params.id).n : 0;
    return { job: job ? { ...job, ahead } : null };
  });
  app.post('/api/matches/:id/video/convert', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!storage || !match?.video_key) return bad(reply, 'No video in the cloud for this match', 404);
    db.prepare("DELETE FROM video_jobs WHERE match_id = ? AND state != 'running'").run(match.id);
    db.prepare('INSERT INTO video_jobs (match_id, source_key) VALUES (?, ?)').run(match.id, match.video_key);
    return { ok: true };
  });
  // For the public link: only matches of that team.
  app.get('/api/share/team/:token/video/:matchId', async (req, reply) => {
    const team = db.prepare('SELECT id FROM teams WHERE share_token = ?').get(req.params.token);
    const match = team && db.prepare('SELECT video_key, video_variants FROM matches WHERE id = ? AND team_id = ?').get(int(req.params.matchId), team.id);
    if (!storage || !match?.video_key) return bad(reply, 'No video', 404);
    return videoLink(match);
  });

  // ---------- detection runs (to measure the auto-detection) ----------
  app.get('/api/matches/:id/runs', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    return db.prepare('SELECT id, params, created_at, events FROM detection_runs WHERE match_id = ? ORDER BY id DESC').all(match.id)
      .map((r) => ({ id: r.id, created_at: r.created_at, params: r.params ? JSON.parse(r.params) : null, events: JSON.parse(r.events) }));
  });

  // ---------- saved versions of a match ----------
  // A version keeps everything tagged for the match; restoring one replaces the tags with
  // it, after saving the current state as a version of its own (so a restore can be undone).
  const VERSION_COLS = ['player_id', 'jersey', 'action', 'value', 'zone', 'x', 'y', 'fx', 'fy', 'rally', 'poss', 't', 'set_no', 'source', 'status', 'confidence', 'hint', 'client_id'];
  const MAX_VERSIONS = 30;
  const listVersions = (matchId) => db.prepare('SELECT id, label, auto, event_count, created_at FROM match_versions WHERE match_id = ? ORDER BY id DESC').all(matchId);
  function saveVersion(match, label, auto) {
    const events = q.events.all(match.id).map((e) => Object.fromEntries(VERSION_COLS.map((k) => [k, e[k]])));
    const data = JSON.stringify({ events, lineups: match.lineups ?? null, calibration: match.calibration ?? null, sheet: match.sheet ?? null });
    const r = db.prepare('INSERT INTO match_versions (match_id, label, auto, event_count, data) VALUES (?, ?, ?, ?, ?)')
      .run(match.id, label, auto ? 1 : 0, events.length, data);
    // Keep the newest; automatic ones go first when there are too many.
    const extra = db.prepare('SELECT id FROM match_versions WHERE match_id = ? ORDER BY auto DESC, id ASC').all(match.id);
    for (const v of extra.slice(0, Math.max(0, extra.length - MAX_VERSIONS))) db.prepare('DELETE FROM match_versions WHERE id = ?').run(v.id);
    return r.lastInsertRowid;
  }

  app.get('/api/matches/:id/versions', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    return listVersions(match.id);
  });

  app.post('/api/matches/:id/versions', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const label = String(req.body?.label ?? '').trim().slice(0, 80) || `Saved ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    saveVersion(match, label, false);
    return listVersions(match.id);
  });

  app.post('/api/matches/:id/versions/:vid/restore', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const v = db.prepare('SELECT * FROM match_versions WHERE id = ? AND match_id = ?').get(req.params.vid, match.id);
    if (!v) return bad(reply, 'Version not found', 404);
    const data = JSON.parse(v.data);
    const playerOk = new Set(db.prepare('SELECT id FROM players').all().map((p) => p.id));
    db.transaction(() => {
      saveVersion(match, `Before restoring "${v.label}"`, true);
      db.prepare('DELETE FROM events WHERE match_id = ?').run(match.id);
      for (const e of data.events ?? []) {
        const row = Object.fromEntries(VERSION_COLS.map((k) => [k, e[k] ?? null]));
        q.insertEvent.run({ ...row, player_id: playerOk.has(row.player_id) ? row.player_id : null, source: row.source ?? 'manual', status: row.status ?? 'confirmed', match_id: match.id });
      }
      db.prepare('UPDATE matches SET lineups = ?, calibration = ?, sheet = ? WHERE id = ?').run(data.lineups, data.calibration, data.sheet, match.id);
    })();
    return { ...matchBundle(q.match.get(match.id)), versions: listVersions(match.id) };
  });

  app.delete('/api/matches/:id/versions/:vid', coach, async (req) => {
    db.prepare('DELETE FROM match_versions WHERE id = ? AND match_id = ?').run(req.params.vid, req.params.id);
    return listVersions(Number(req.params.id));
  });

  // ---------- app updates (GitHub releases, through the server) ----------
  // What the About page shows about this server, and the newest app of a channel.
  app.get('/api/about', coach, async () => ({
    ai: { scan: !!vision?.enabled, summary: !!insights?.enabled, touches: !!touches?.enabled, model: touches?.model ?? null },
    updates: { configured: !!updates?.configured, repo: updates?.repo ?? null },
  }));

  app.get('/api/app/update', coach, async (req, reply) => {
    if (!updates?.configured) return { configured: false, latest: null };
    const channel = req.query?.channel === 'test' ? 'test' : 'stable';
    try {
      return { configured: true, channel, latest: await updates.latest(channel) };
    } catch (e) {
      return bad(reply, `Could not ask GitHub for updates: ${String(e?.message ?? e).slice(0, 200)}`, 502);
    }
  });

  app.get('/api/app/apk/:asset', coach, async (req, reply) => {
    if (!updates?.configured) return bad(reply, 'Updates are not set up on this server (UPDATE_REPO)', 503);
    if (!/^\d{1,12}$/.test(req.params.asset)) return bad(reply, 'Unknown file');
    try {
      const { stream, size } = await updates.download(req.params.asset);
      reply.header('Content-Type', 'application/vnd.android.package-archive');
      reply.header('Content-Disposition', 'attachment; filename="VolleyIQ.apk"');
      if (size) reply.header('Content-Length', String(size));
      return reply.send(stream);
    } catch (e) {
      return bad(reply, `Download failed: ${String(e?.message ?? e).slice(0, 200)}`, 502);
    }
  });
}
