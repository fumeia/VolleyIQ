import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ACTIONS, ROLES } from './actions.js';
import { requireCoach, requireWorker } from './auth.js';

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);

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
function cleanEvent(body) {
  if (!ACTIONS.includes(body.action)) return [null, `Unknown action ${body.action}`];
  const value = int(body.value);
  if (value !== null && (value < 0 || value > 3)) return [null, 'value must be 0..3'];
  const zone = int(body.zone);
  if (zone !== null && (zone < 1 || zone > 6)) return [null, 'zone must be 1..6'];
  return [{
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
    client_id: body.client_id ? String(body.client_id).slice(0, 64) : null,
  }, null];
}

export function registerRoutes(app, { db, videosDir }) {
  const q = {
    teams: db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM players p WHERE p.team_id = t.id AND p.active = 1) AS player_count
                       FROM teams t ORDER BY t.name`),
    team: db.prepare('SELECT * FROM teams WHERE id = ?'),
    players: db.prepare('SELECT * FROM players WHERE team_id = ? ORDER BY active DESC, number, name'),
    player: db.prepare('SELECT * FROM players WHERE id = ?'),
    matches: db.prepare(`SELECT m.*, t.name AS team_name,
                           (SELECT COUNT(*) FROM events e WHERE e.match_id = m.id) AS event_count,
                           (SELECT COUNT(*) FROM events e WHERE e.match_id = m.id AND e.status = 'suggested') AS suggested_count
                         FROM matches m LEFT JOIN teams t ON t.id = m.team_id
                         ORDER BY COALESCE(m.played_on, m.created_at) DESC, m.id DESC`),
    match: db.prepare('SELECT m.*, t.name AS team_name FROM matches m LEFT JOIN teams t ON t.id = m.team_id WHERE m.id = ?'),
    matchByToken: db.prepare('SELECT m.*, t.name AS team_name FROM matches m LEFT JOIN teams t ON t.id = m.team_id WHERE m.share_token = ?'),
    events: db.prepare('SELECT * FROM events WHERE match_id = ? ORDER BY COALESCE(t, 1e12), id'),
    event: db.prepare('SELECT * FROM events WHERE id = ?'),
    eventByClient: db.prepare('SELECT * FROM events WHERE match_id = ? AND client_id = ?'),
    insertEvent: db.prepare(`INSERT INTO events (match_id, player_id, jersey, action, value, zone, t, set_no, source, status, confidence, client_id)
                             VALUES (@match_id, @player_id, @jersey, @action, @value, @zone, @t, @set_no, @source, @status, @confidence, @client_id)`),
    jobsForMatch: db.prepare('SELECT * FROM jobs WHERE match_id = ? ORDER BY id DESC'),
    job: db.prepare('SELECT * FROM jobs WHERE id = ?'),
  };

  const coach = { onRequest: requireCoach };
  const worker = { onRequest: requireWorker };

  function matchBundle(match) {
    const players = match.team_id ? q.players.all(match.team_id) : [];
    return { match, players, events: q.events.all(match.id) };
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
    return { ...matchBundle(match), jobs: q.jobsForMatch.all(match.id) };
  });

  app.patch('/api/matches/:id', coach, async (req, reply) => {
    const m = q.match.get(req.params.id);
    if (!m) return bad(reply, 'Not found', 404);
    const b = req.body ?? {};
    const pick = (k) => (k in b ? b[k] : m[k]);
    db.prepare(`UPDATE matches SET team_id = ?, label = ?, opponent = ?, played_on = ?, mode = ?, video_type = ?, video_ref = ? WHERE id = ?`)
      .run(int(pick('team_id')), pick('label'), pick('opponent'), pick('played_on'), pick('mode'), pick('video_type'), pick('video_ref'), m.id);
    return q.match.get(m.id);
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

  // Season / multi-match report: all confirmed events for a team.
  app.get('/api/teams/:id/report', coach, async (req, reply) => {
    const team = q.team.get(req.params.id);
    if (!team) return bad(reply, 'Not found', 404);
    const matches = db.prepare('SELECT * FROM matches WHERE team_id = ? ORDER BY played_on, id').all(team.id);
    const events = db.prepare(`SELECT e.* FROM events e JOIN matches m ON m.id = e.match_id
                               WHERE m.team_id = ? AND e.status = 'confirmed'`).all(team.id);
    return { team, players: q.players.all(team.id), matches, events };
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
    db.prepare(`UPDATE events SET player_id = @player_id, jersey = @jersey, action = @action, value = @value, zone = @zone,
                t = @t, set_no = @set_no, status = @status, confidence = @confidence WHERE id = @id`)
      .run({ ...ev, source: cur.source, id: cur.id });
    return q.event.get(cur.id);
  });

  app.delete('/api/events/:id', coach, async (req) => {
    db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  app.post('/api/matches/:id/events/bulk', coach, async (req, reply) => {
    const { op, ids } = req.body ?? {};
    if (!Array.isArray(ids)) return bad(reply, 'ids required');
    const run = db.transaction(() => {
      for (const id of ids) {
        if (op === 'confirm') db.prepare("UPDATE events SET status = 'confirmed' WHERE id = ? AND match_id = ?").run(id, req.params.id);
        else if (op === 'delete') db.prepare('DELETE FROM events WHERE id = ? AND match_id = ?').run(id, req.params.id);
      }
    });
    run();
    return { ok: true };
  });

  // ---------- video upload & streaming ----------
  app.post('/api/matches/:id/video', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    const file = await req.file();
    if (!file) return bad(reply, 'No file');
    const ext = path.extname(file.filename || '').toLowerCase() || '.mp4';
    if (!VIDEO_EXT.has(ext)) return bad(reply, `Unsupported file type ${ext}`);
    const name = `match-${match.id}-${Date.now()}${ext}`;
    const dest = path.join(videosDir, name);
    await pipeline(file.file, fs.createWriteStream(dest));
    if (file.file.truncated) {
      fs.rmSync(dest, { force: true });
      return bad(reply, 'File too large', 413);
    }
    db.prepare("UPDATE matches SET video_type = 'upload', video_ref = ? WHERE id = ?").run(name, match.id);
    return q.match.get(match.id);
  });

  app.get('/media/:name', async (req, reply) => {
    const name = path.basename(req.params.name);
    const token = req.query.share;
    const allowed = req.user?.coach || req.user?.worker
      || (token && db.prepare('SELECT 1 FROM matches WHERE share_token = ? AND video_ref = ?').get(token, name));
    if (!allowed) return bad(reply, 'Not allowed', 401);
    if (!fs.existsSync(path.join(videosDir, name))) return bad(reply, 'Not found', 404);
    return reply.sendFile(name, videosDir);
  });

  // ---------- auto-analysis jobs ----------
  app.post('/api/matches/:id/analyze', coach, async (req, reply) => {
    const match = q.match.get(req.params.id);
    if (!match) return bad(reply, 'Match not found', 404);
    if (!['youtube', 'upload'].includes(match.video_type)) {
      return bad(reply, 'Auto-analysis needs a YouTube link or an uploaded video (local-only files stay on your phone).');
    }
    const active = db.prepare("SELECT id FROM jobs WHERE match_id = ? AND status IN ('queued','running')").get(match.id);
    if (active) return bad(reply, 'Analysis already running for this match', 409);
    const options = {
      jersey_ocr: req.body?.jersey_ocr !== false,
      replace_suggestions: req.body?.replace_suggestions !== false,
    };
    const r = db.prepare('INSERT INTO jobs (match_id, options) VALUES (?, ?)').run(match.id, JSON.stringify(options));
    return q.job.get(r.lastInsertRowid);
  });

  app.get('/api/jobs/:id', coach, async (req, reply) => q.job.get(req.params.id) ?? bad(reply, 'Not found', 404));

  // Worker protocol: claim → progress* → events → finish.
  app.post('/api/worker/claim', worker, async (req, reply) => {
    const claim = db.transaction(() => {
      const job = db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get();
      if (!job) return null;
      db.prepare("UPDATE jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?").run(job.id);
      return job;
    });
    const job = claim();
    if (!job) return reply.code(204).send();
    const match = q.match.get(job.match_id);
    return {
      job: { ...job, options: JSON.parse(job.options || '{}') },
      match,
      players: match.team_id ? q.players.all(match.team_id).filter((p) => p.active) : [],
      video_path: match.video_type === 'upload' ? match.video_ref : null,
    };
  });

  app.post('/api/worker/jobs/:id/progress', worker, async (req) => {
    db.prepare("UPDATE jobs SET progress = ?, message = ?, updated_at = datetime('now') WHERE id = ?")
      .run(num(req.body.progress) ?? 0, req.body.message ?? null, req.params.id);
    return { ok: true };
  });

  app.post('/api/worker/jobs/:id/finish', worker, async (req, reply) => {
    const job = q.job.get(req.params.id);
    if (!job) return bad(reply, 'Not found', 404);
    const match = q.match.get(job.match_id);
    const options = JSON.parse(job.options || '{}');
    const { status = 'done', message = null, events = [] } = req.body ?? {};
    const save = db.transaction(() => {
      if (status === 'done' && options.replace_suggestions) {
        db.prepare("DELETE FROM events WHERE match_id = ? AND source = 'auto' AND status = 'suggested'").run(match.id);
      }
      let n = 0;
      for (const raw of events) {
        const [ev] = cleanEvent({ ...raw, source: 'auto', status: 'suggested' });
        if (!ev) continue;
        q.insertEvent.run({ ...attachPlayer(match, ev), match_id: match.id });
        n++;
      }
      db.prepare("UPDATE jobs SET status = ?, progress = 1, message = ?, updated_at = datetime('now') WHERE id = ?")
        .run(status === 'failed' ? 'failed' : 'done', message ?? `${n} events suggested`, job.id);
      return n;
    });
    return { ok: true, inserted: save() };
  });

  // Jobs stuck in "running" (worker crashed) go back to the queue on restart.
  db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'running' AND updated_at < datetime('now', '-30 minutes')").run();
}
