// Clip playlists: tags from any of a team's matches, in a chosen order, for video sessions.
// The coach makes them; the public link plays them in Replays.
import { requireCoach } from './auth.js';

const coach = { preHandler: requireCoach };
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

/** A team's playlists with their tags in order (only tags that still exist and are confirmed). */
export function teamPlaylists(db, teamId) {
  return db.prepare('SELECT id, title, created_at FROM playlists WHERE team_id = ? ORDER BY id').all(teamId).map((p) => ({
    ...p,
    items: db.prepare(`SELECT i.event_id FROM playlist_items i JOIN events e ON e.id = i.event_id
      WHERE i.playlist_id = ? AND e.status = 'confirmed' ORDER BY i.position, i.event_id`).all(p.id).map((r) => r.event_id),
  }));
}

export function registerPlaylists(app, { db }) {
  const own = (id) => db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  const one = (id) => teamPlaylists(db, own(id).team_id).find((p) => p.id === Number(id));

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
    const ids = (Array.isArray(req.body?.event_ids) ? req.body.event_ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
    const rows = ids.length ? db.prepare(`SELECT e.id FROM events e JOIN matches m ON m.id = e.match_id
      WHERE m.team_id = ? AND e.id IN (${ids.map(() => '?').join(',')}) ORDER BY m.played_on, m.id, e.t`).all(p.team_id, ...ids) : [];
    let pos = db.prepare('SELECT COALESCE(MAX(position), -1) AS n FROM playlist_items WHERE playlist_id = ?').get(p.id).n;
    const add = db.prepare('INSERT OR IGNORE INTO playlist_items (playlist_id, event_id, position) VALUES (?, ?, ?)');
    db.transaction(() => { for (const r of rows) add.run(p.id, r.id, ++pos); })();
    return one(p.id);
  });

  app.delete('/api/playlists/:id/items/:eventId', coach, async (req, reply) => {
    if (!own(req.params.id)) return bad(reply, 'Not found', 404);
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND event_id = ?').run(req.params.id, req.params.eventId);
    return one(req.params.id);
  });
}
