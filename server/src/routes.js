import crypto from 'node:crypto';
import { ACTIONS, ROLES } from './actions.js';
import { requireCoach } from './auth.js';
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

export function registerRoutes(app, { db, vision, insights }) {
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
                           (SELECT COUNT(*) FROM events e WHERE e.match_id = m.id AND e.status = 'confirmed' AND e.source = 'auto') AS auto_confirmed_count
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
    return m && { ...m, calibration: m.calibration ? JSON.parse(m.calibration) : null, lineups: m.lineups ? JSON.parse(m.lineups) : null };
  }

  function matchBundle(match) {
    const players = match.team_id ? q.players.all(match.team_id) : [];
    return { match: withCalibration(match), players, events: q.events.all(match.id) };
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
    db.prepare('UPDATE teams SET name = ?, coach = ? WHERE id = ?')
      .run(req.body.name ?? team.name, req.body.coach ?? team.coach, team.id);
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
    db.prepare(`UPDATE matches SET team_id = ?, label = ?, opponent = ?, played_on = ?, mode = ?, video_type = ?, video_ref = ?, calibration = ?, lineups = ? WHERE id = ?`)
      .run(int(pick('team_id')), pick('label'), pick('opponent'), pick('played_on'), pick('mode'), pick('video_type'), pick('video_ref'), calibration, lineups, m.id);
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
    return { ...bundle, events: bundle.events.filter((e) => e.status === 'confirmed') };
  });

  app.post('/api/teams/:id/share', coach, async (req, reply) => {
    const t = q.team.get(req.params.id);
    if (!t) return bad(reply, 'Not found', 404);
    const token = req.body?.revoke ? null : (t.share_token ?? crypto.randomBytes(12).toString('base64url'));
    db.prepare('UPDATE teams SET share_token = ? WHERE id = ?').run(token, t.id);
    return { share_token: token };
  });

  // Public season report: confirmed tags only; no tokens or calibration data leak out.
  app.get('/api/share/team/:token', async (req, reply) => {
    const team = db.prepare('SELECT id, name FROM teams WHERE share_token = ?').get(req.params.token);
    if (!team) return bad(reply, 'Not found', 404);
    const matches = db.prepare('SELECT id, label, opponent, played_on FROM matches WHERE team_id = ? ORDER BY played_on, id').all(team.id);
    const events = db.prepare(`SELECT e.id, e.match_id, e.player_id, e.jersey, e.action, e.value, e.zone, e.x, e.y, e.t, e.set_no, e.status
                               FROM events e JOIN matches m ON m.id = e.match_id
                               WHERE m.team_id = ? AND e.status = 'confirmed'`).all(team.id);
    return { team, players: q.players.all(team.id), matches: matches.map(withCalibration), events };
  });

  // Season / multi-match report: all confirmed events for a team.
  app.get('/api/teams/:id/report', coach, async (req, reply) => {
    const team = q.team.get(req.params.id);
    if (!team) return bad(reply, 'Not found', 404);
    const matches = db.prepare('SELECT * FROM matches WHERE team_id = ? ORDER BY played_on, id').all(team.id);
    const events = db.prepare(`SELECT e.* FROM events e JOIN matches m ON m.id = e.match_id
                               WHERE m.team_id = ? AND e.status = 'confirmed'`).all(team.id);
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
    if (!vision?.enabled) return bad(reply, 'Match-sheet scanning is not set up on this server (needs an AI backend — LiteLLM or Anthropic).', 503);
    const [images, err] = cleanImages(req.body);
    if (err) return bad(reply, err);
    try {
      const data = await vision.scan(images);
      return { data };
    } catch (e) {
      req.log?.error({ err: e }, 'match sheet scan failed');
      return bad(reply, 'Could not read the match sheet. Try a sharper, straight-on photo.', 502);
    }
  });

  app.get('/api/insights/enabled', coach, async () => ({ enabled: !!insights?.enabled }));

  app.post('/api/insights/summary', coach, async (req, reply) => {
    if (!insights?.enabled) return bad(reply, 'AI insights are not set up on this server (needs an AI backend — LiteLLM or Anthropic).', 503);
    const stats = req.body?.stats;
    const lang = req.body?.lang === 'de' ? 'de' : 'en';
    if (!stats || typeof stats !== 'object') return bad(reply, 'stats object required');
    if (JSON.stringify(stats).length > 60000) return bad(reply, 'stats too large');
    try {
      const bullets = await insights.generate(stats, lang);
      return { bullets };
    } catch (e) {
      req.log?.error({ err: e }, 'insights failed');
      return bad(reply, 'Could not generate the summary. Try again.', 502);
    }
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
    const { events = [], replace = true } = req.body ?? {};
    if (!Array.isArray(events) || events.length > 10000) return bad(reply, 'events must be an array (max 10000)');
    const save = db.transaction(() => {
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
}
