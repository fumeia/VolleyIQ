// Clip playlists: tags from any of a team's matches, in a chosen order, for video sessions.
// The coach makes them; the public link plays them in Replays.
import { requireCoach } from './auth.js';

const coach = { preHandler: requireCoach };
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

/**
 * A team's playlists with their tags in order (only tags that still exist and are confirmed).
 * [view]: 'coach' = all; otherwise the public ones and, with a [jersey], that teammate's private ones too.
 */
export function teamPlaylists(db, teamId, { view = 'coach', jersey = null } = {}) {
  const where = view === 'coach' ? '' : ` AND (is_public = 1${Number.isInteger(jersey) ? ' OR owner_jersey = @jersey' : ''})`;
  return db.prepare(`SELECT id, title, created_at, owner_jersey, is_public FROM playlists WHERE team_id = @team${where} ORDER BY owner_jersey IS NOT NULL, id`)
    .all({ team: teamId, jersey }).map((p) => ({
      ...p,
      is_public: !!p.is_public,
      items: db.prepare(`SELECT i.event_id FROM playlist_items i JOIN events e ON e.id = i.event_id
        WHERE i.playlist_id = ? AND e.status = 'confirmed' ORDER BY i.position, i.event_id`).all(p.id).map((r) => r.event_id),
    }));
}

/** Adds tags of the team to a playlist, after its last clip, match by match in video order. */
function addItems(db, p, eventIds) {
  const ids = (Array.isArray(eventIds) ? eventIds : []).map(Number).filter(Number.isInteger).slice(0, 500);
  const rows = ids.length ? db.prepare(`SELECT e.id FROM events e JOIN matches m ON m.id = e.match_id
    WHERE m.team_id = ? AND e.status = 'confirmed' AND e.id IN (${ids.map(() => '?').join(',')}) ORDER BY m.played_on, m.id, e.t`).all(p.team_id, ...ids) : [];
  let pos = db.prepare('SELECT COALESCE(MAX(position), -1) AS n FROM playlist_items WHERE playlist_id = ?').get(p.id).n;
  const add = db.prepare('INSERT OR IGNORE INTO playlist_items (playlist_id, event_id, position) VALUES (?, ?, ?)');
  db.transaction(() => { for (const r of rows) add.run(p.id, r.id, ++pos); })();
}

export function registerPlaylists(app, { db }) {
  const own = (id) => db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  const one = (id) => teamPlaylists(db, own(id).team_id).find((p) => p.id === Number(id));

  // ---------- teammates on the public link: their own playlists, by shirt number ----------
  const shareTeam = (token) => db.prepare('SELECT id FROM teams WHERE share_token = ?').get(token);
  const jerseyOf = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null; };
  /** The teammate's own playlist (by shirt number), or an error sent. */
  const mine = (req, reply) => {
    const team = shareTeam(req.params.token);
    if (!team) { bad(reply, 'Not found', 404); return null; }
    const jersey = jerseyOf(req.body?.jersey ?? req.query?.jersey);
    if (jersey == null) { bad(reply, 'Your shirt number is needed'); return null; }
    const p = db.prepare('SELECT * FROM playlists WHERE id = ? AND team_id = ?').get(req.params.id, team.id);
    if (!p) { bad(reply, 'Not found', 404); return null; }
    if (p.owner_jersey !== jersey) { bad(reply, 'Only the player who made this playlist can change it', 403); return null; }
    return p;
  };
  const rate = new Map();   // ip -> { hour, n }: at most 200 changes an hour per address
  const tooMany = (req) => {
    const hour = Math.floor(Date.now() / 3600000);
    const r = rate.get(req.ip);
    if (r && r.hour === hour && r.n >= 200) return true;
    rate.set(req.ip, { hour, n: r?.hour === hour ? r.n + 1 : 1 });
    return false;
  };

  app.get('/api/share/team/:token/playlists', async (req, reply) => {
    const team = shareTeam(req.params.token);
    if (!team) return bad(reply, 'Not found', 404);
    return teamPlaylists(db, team.id, { view: 'public', jersey: jerseyOf(req.query?.jersey) }).filter((p) => p.items.length || p.owner_jersey === jerseyOf(req.query?.jersey));
  });
  app.post('/api/share/team/:token/playlists', async (req, reply) => {
    const team = shareTeam(req.params.token);
    if (!team) return bad(reply, 'Not found', 404);
    const jersey = jerseyOf(req.body?.jersey);
    if (jersey == null) return bad(reply, 'Your shirt number is needed');
    const title = String(req.body?.title ?? '').trim().slice(0, 80);
    if (!title) return bad(reply, 'A name is needed');
    if (tooMany(req)) return bad(reply, 'Too many changes, try again later', 429);
    if (db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE team_id = ? AND owner_jersey = ?').get(team.id, jersey).n >= 30) return bad(reply, 'At most 30 playlists per player', 429);
    const id = db.prepare('INSERT INTO playlists (team_id, title, owner_jersey, is_public) VALUES (?, ?, ?, ?)').run(team.id, title, jersey, req.body?.public === false ? 0 : 1).lastInsertRowid;
    return one(id);
  });
  app.patch('/api/share/team/:token/playlists/:id', async (req, reply) => {
    const p = mine(req, reply);
    if (!p) return reply;
    if (tooMany(req)) return bad(reply, 'Too many changes, try again later', 429);
    const title = String(req.body?.title ?? '').trim().slice(0, 80);
    if (title) db.prepare('UPDATE playlists SET title = ? WHERE id = ?').run(title, p.id);
    if (typeof req.body?.public === 'boolean') db.prepare('UPDATE playlists SET is_public = ? WHERE id = ?').run(req.body.public ? 1 : 0, p.id);
    if (Array.isArray(req.body?.order)) {
      const set = db.prepare('UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND event_id = ?');
      db.transaction(() => req.body.order.forEach((eid, i) => set.run(i, p.id, Number(eid))))();
    }
    return one(p.id);
  });
  app.delete('/api/share/team/:token/playlists/:id', async (req, reply) => {
    const p = mine(req, reply);
    if (!p) return reply;
    db.prepare('DELETE FROM playlists WHERE id = ?').run(p.id);
    return { ok: true };
  });
  app.post('/api/share/team/:token/playlists/:id/items', async (req, reply) => {
    const p = mine(req, reply);
    if (!p) return reply;
    if (tooMany(req)) return bad(reply, 'Too many changes, try again later', 429);
    addItems(db, p, req.body?.event_ids);
    return one(p.id);
  });
  app.delete('/api/share/team/:token/playlists/:id/items/:eventId', async (req, reply) => {
    const p = mine(req, reply);
    if (!p) return reply;
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND event_id = ?').run(p.id, req.params.eventId);
    return one(p.id);
  });

  app.get('/api/teams/:id/playlists', coach, async (req) => teamPlaylists(db, Number(req.params.id)));

  app.post('/api/teams/:id/playlists', coach, async (req, reply) => {
    const title = String(req.body?.title ?? '').trim().slice(0, 80);
    if (!title) return bad(reply, 'A name is needed');
    if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(req.params.id)) return bad(reply, 'Not found', 404);
    const id = db.prepare('INSERT INTO playlists (team_id, title) VALUES (?, ?)').run(req.params.id, title).lastInsertRowid;
    return one(id);
  });

  app.patch('/api/playlists/:id', coach, async (req, reply) => {
    if (!own(req.params.id)) return bad(reply, 'Not found', 404);
    const title = String(req.body?.title ?? '').trim().slice(0, 80);
    if (title) db.prepare('UPDATE playlists SET title = ? WHERE id = ?').run(title, req.params.id);
    // A new order: the event ids from first to last.
    if (Array.isArray(req.body?.order)) {
      const set = db.prepare('UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND event_id = ?');
      db.transaction(() => req.body.order.forEach((eid, i) => set.run(i, req.params.id, Number(eid))))();
    }
    return one(req.params.id);
  });

  app.delete('/api/playlists/:id', coach, async (req) => {
    db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // Add tags (of the playlist's team) at the end, in video order per match.
  app.post('/api/playlists/:id/items', coach, async (req, reply) => {
    const p = own(req.params.id);
    if (!p) return bad(reply, 'Not found', 404);
    addItems(db, p, req.body?.event_ids);
    return one(p.id);
  });

  app.delete('/api/playlists/:id/items/:eventId', coach, async (req, reply) => {
    if (!own(req.params.id)) return bad(reply, 'Not found', 404);
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND event_id = ?').run(req.params.id, req.params.eventId);
    return one(req.params.id);
  });
}
