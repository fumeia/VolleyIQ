// Team schedules from Swiss Volley, other teams' games and videos found for games.
import { requireCoach } from './auth.js';
import { clubTeams, fetchCalendar, findCalendar, findVideos, forTeam, isClubCalendar, leagueGames, parseLink } from './swissvolley.js';

const coach = { preHandler: requireCoach };
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
const HOURS = 3600 * 1000;

/** First and last day of the season a date falls in (August to July). */
function season(date = new Date()) {
  const y = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
  return { from: `${y}-08-01`, to: `${y + 1}-07-31` };
}

export function makeSchedule(db, { fetchFn = fetch, youtubeKey = null, log = () => {} } = {}) {
  const team = (id) => db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  const cache = {
    get: (key, maxAgeMs) => {
      const r = db.prepare('SELECT data, fetched_at FROM sv_cache WHERE key = ?').get(key);
      if (!r) return null;
      if (maxAgeMs != null && Date.now() - Date.parse(`${r.fetched_at.replace(' ', 'T')}Z`) > maxAgeMs) return null;
      return JSON.parse(r.data);
    },
    set: (key, data) => db.prepare("INSERT INTO sv_cache (key, data, fetched_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at").run(key, JSON.stringify(data)),
  };

  /** Reads the team's calendar and stores its games. */
  async function sync(teamId) {
    const t = team(teamId);
    if (!t?.sv_ical) return null;
    try {
      const cal = await fetchCalendar(t.sv_ical, fetchFn);
      const filter = t.sv_filter ? JSON.parse(t.sv_filter) : null;
      if (filter) cal.games = forTeam(cal.games, filter);
      const caption = filter?.name ?? cal.team?.caption ?? t.sv_caption;
      const keep = new Set();
      const upsert = db.prepare(`INSERT INTO schedule (team_id, game_id, starts_at, home, away, side, league, league_id, hall, address, result, cancelled)
        VALUES (@team, @gameId, @start, @home, @away, @side, @league, @leagueId, @hall, @address, @result, @cancelled)
        ON CONFLICT(team_id, game_id) DO UPDATE SET starts_at = excluded.starts_at, home = excluded.home, away = excluded.away, side = excluded.side,
          league = excluded.league, league_id = excluded.league_id, hall = excluded.hall, address = excluded.address, result = excluded.result, cancelled = excluded.cancelled`);
      db.transaction(() => {
        for (const g of cal.games) {
          keep.add(g.gameId);
          upsert.run({ team: t.id, ...g, side: g.home === caption ? 'home' : g.away === caption ? 'away' : null, cancelled: g.cancelled ? 1 : 0 });
        }
        // Games no longer in the calendar go, unless a tagged match belongs to them.
        for (const r of db.prepare('SELECT id, game_id FROM schedule WHERE team_id = ? AND match_id IS NULL').all(t.id)) {
          if (!keep.has(r.game_id)) db.prepare('DELETE FROM schedule WHERE id = ?').run(r.id);
        }
        // A match tagged on the same day against that opponent belongs to the game.
        for (const r of db.prepare('SELECT * FROM schedule WHERE team_id = ? AND match_id IS NULL').all(t.id)) {
          const m = db.prepare(`SELECT id, opponent FROM matches WHERE team_id = ? AND played_on = ? AND id NOT IN (SELECT match_id FROM schedule WHERE match_id IS NOT NULL)`)
            .all(t.id, r.starts_at.slice(0, 10));
          const opp = (r.side === 'home' ? r.away : r.home) ?? '';
          const hit = m.length === 1 ? m[0] : m.find((x) => x.opponent && opp.toLowerCase().includes(x.opponent.toLowerCase()));
          if (hit) db.prepare('UPDATE schedule SET match_id = ? WHERE id = ?').run(hit.id, r.id);
        }
        db.prepare("UPDATE teams SET sv_caption = ?, sv_team_id = COALESCE(?, sv_team_id), sv_synced_at = datetime('now'), sv_error = NULL WHERE id = ?")
          .run(caption, filter ? null : cal.team?.teamId ?? null, t.id);
      })();
      return cal.games.length;
    } catch (e) {
      db.prepare('UPDATE teams SET sv_error = ? WHERE id = ?').run(String(e.message ?? e).slice(0, 200), t.id);
      log(`schedule sync of team ${t.id} failed: ${e.message}`);
      throw e;
    }
  }

  /**
   * Links a team to Swiss Volley from a pasted team page or calendar link. A club calendar
   * holds all the club's teams: then the answer is { choices } until one is [pick]ed.
   */
  async function connect(teamId, link, pick = null) {
    const target = parseLink(link);
    if (!target) throw Object.assign(new Error('Paste the link of your team page in the Swiss Volley game center (…/club/…/team/…) or its calendar link'), { status: 400 });
    let ical = target.ical, caption = null, filter = null;
    if (!ical) ({ ical, caption } = await findCalendar(target.clubId, target.teamId, fetchFn));
    else {
      const cal = await fetchCalendar(ical, fetchFn);
      if (isClubCalendar(cal)) {
        const choices = clubTeams(cal.games);
        const chosen = pick && choices.find((c) => c.name === pick.name && JSON.stringify(c.leagues) === JSON.stringify(pick.leagues ?? null));
        if (!chosen) return { club: cal.team?.caption ?? null, choices };
        filter = { name: chosen.name, leagues: chosen.leagues };
        caption = chosen.name;
      }
    }
    db.prepare('UPDATE teams SET sv_link = ?, sv_ical = ?, sv_team_id = ?, sv_caption = ?, sv_filter = ?, sv_error = NULL WHERE id = ?')
      .run(String(link).trim(), ical, target.teamId ?? null, caption, filter ? JSON.stringify(filter) : null, teamId);
    await sync(teamId);
    return team(teamId);
  }

  /** All games of a league this season (kept for 6 hours). */
  async function league(leagueId) {
    const key = `league:${leagueId}`;
    const fresh = cache.get(key, 6 * HOURS);
    if (fresh) return fresh;
    try {
      const games = await leagueGames(leagueId, {
        ...season(), fetchFn,
        cache: { get: () => cache.get('action:games'), set: (id) => cache.set('action:games', id) },
      });
      cache.set(key, games);
      return games;
    } catch (e) {
      const old = cache.get(key);
      if (old) return old;
      throw e;
    }
  }

  const videoOf = (gameId) => {
    const v = db.prepare('SELECT * FROM game_videos WHERE game_id = ?').get(gameId);
    return v ? { state: v.state, url: v.url, title: v.title, candidates: v.candidates ? JSON.parse(v.candidates) : [], searched_at: v.searched_at } : null;
  };

  /** Searches YouTube for a game; the best match is suggested until someone confirms or rejects it. */
  async function searchVideo(game) {
    if (!youtubeKey) throw Object.assign(new Error('Video search is not set up on the server (YOUTUBE_API_KEY in .env)'), { status: 503 });
    const found = await findVideos(game, { key: youtubeKey, fetchFn });
    const old = videoOf(game.gameId);
    const keepChoice = old?.state === 'confirmed';
    db.prepare(`INSERT INTO game_videos (game_id, candidates, url, title, state, searched_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(game_id) DO UPDATE SET candidates = excluded.candidates, searched_at = excluded.searched_at,
        url = CASE WHEN game_videos.state = 'confirmed' THEN game_videos.url ELSE excluded.url END,
        title = CASE WHEN game_videos.state = 'confirmed' THEN game_videos.title ELSE excluded.title END,
        state = CASE WHEN game_videos.state = 'confirmed' THEN 'confirmed' ELSE excluded.state END`)
      .run(game.gameId, JSON.stringify(found), keepChoice ? old.url : found[0]?.url ?? null, keepChoice ? old.title : found[0]?.title ?? null, found.length ? 'found' : 'none');
    return videoOf(game.gameId);
  }

  /**
   * Every game of the other team this season, whatever the competition: found in the game's
   * league, then read from that team's own calendar (kept 6 hours). Set scores come from the
   * league data where it has the game. Without its calendar: the games of that league only.
   */
  async function opponentGames(leagueId, opponent) {
    const games = await league(leagueId);
    const scores = new Map(games.map((g) => [g.gameId, g]));
    const one = games.find((g) => g.home === opponent || g.away === opponent);
    const teamId = one ? (one.home === opponent ? one.homeId : one.awayId) : null;
    const clubId = one ? (one.home === opponent ? one.homeClub : one.awayClub) : null;
    if (teamId && clubId) {
      const key = `team:${teamId}`;
      let cal = cache.get(key, 6 * HOURS);
      if (!cal) {
        try {
          const { ical } = await findCalendar(clubId, teamId, fetchFn);
          cal = (await fetchCalendar(ical, fetchFn)).games;
          cache.set(key, cal);
        } catch { cal = cache.get(key); }
      }
      if (cal) {
        return cal.map((g) => ({
          gameId: g.gameId, start: g.start, home: g.home, away: g.away, league: g.league, group: null, hall: g.hall,
          result: scores.get(g.gameId)?.result ?? g.result, sets: scores.get(g.gameId)?.sets ?? [],
        }));
      }
    }
    return games.filter((g) => g.home === opponent || g.away === opponent);
  }

  /** The title of a video page (YouTube and Vimeo say it without a key); null when unknown. */
  async function videoTitle(url) {
    const oembed = /youtu\.?be/.test(url) ? 'https://www.youtube.com/oembed?format=json&url=' : /vimeo\.com/.test(url) ? 'https://vimeo.com/api/oembed.json?url=' : null;
    if (!oembed) return null;
    try {
      const res = await fetchFn(oembed + encodeURIComponent(url), { headers: { 'User-Agent': 'VolleyIQ' }, signal: AbortSignal.timeout(6000) });
      return res.ok ? String((await res.json()).title ?? '').slice(0, 200) || null : null;
    } catch { return null; }
  }

  return { sync, connect, league, opponentGames, videoOf, searchVideo, videoTitle, cache };
}

export function registerSchedule(app, { db, schedule, youtube }) {
  const openSuggestions = (teamId, gameId) => db.prepare("SELECT id, url, title, sender_jersey, note, created_at FROM video_suggestions WHERE team_id = ? AND game_id = ? AND status = 'open' ORDER BY id").all(teamId, gameId);
  const rowOut = (r) => ({ ...r, cancelled: !!r.cancelled, video: schedule.videoOf(r.game_id), suggestions: openSuggestions(r.team_id, r.game_id) });

  // ---------- the public team page: its games, their videos, and video suggestions ----------
  const shareTeam = (token) => db.prepare('SELECT id, name FROM teams WHERE share_token = ?').get(token);
  app.get('/api/share/team/:token/schedule', async (req, reply) => {
    const team = shareTeam(req.params.token);
    if (!team) return bad(reply, 'Not found', 404);
    const games = db.prepare('SELECT * FROM schedule WHERE team_id = ? ORDER BY starts_at').all(team.id).map((r) => {
      const v = schedule.videoOf(r.game_id);
      // Only what the coach confirmed is public; found candidates and searches are not.
      return {
        id: r.id, team_id: r.team_id, team_name: team.name, game_id: r.game_id, starts_at: r.starts_at, home: r.home, away: r.away, side: r.side,
        league: r.league, league_id: null, hall: r.hall, address: r.address, result: r.result, cancelled: !!r.cancelled, match_id: r.match_id,
        video: v?.state === 'confirmed' ? { state: 'confirmed', url: v.url, title: v.title, candidates: [], searched_at: null } : null,
      };
    });
    return { games };
  });

  const suggestRate = new Map();   // ip -> { hour, n }: at most 20 video suggestions an hour per address
  app.post('/api/share/team/:token/games/:gameId/video', async (req, reply) => {
    const team = shareTeam(req.params.token);
    if (!team) return bad(reply, 'Not found', 404);
    const gameId = Number(req.params.gameId);
    if (!db.prepare('SELECT 1 FROM schedule WHERE team_id = ? AND game_id = ?').get(team.id, gameId)) return bad(reply, 'Not a game of this team', 404);
    const url = String(req.body?.url ?? '').trim();
    if (!/^https?:\/\/[^\s]+$/.test(url) || url.length > 500) return bad(reply, 'Paste the full link of the video, starting with https://');
    const jersey = Number(req.body?.jersey);
    if (!Number.isInteger(jersey) || jersey < 0 || jersey > 99) return bad(reply, 'Your shirt number is needed');
    const hour = Math.floor(Date.now() / 3600000);
    const r = suggestRate.get(req.ip);
    if (r && r.hour === hour && r.n >= 20) return bad(reply, 'Too many suggestions, try again later', 429);
    suggestRate.set(req.ip, { hour, n: r?.hour === hour ? r.n + 1 : 1 });
    const open = openSuggestions(team.id, gameId);
    if (open.some((s) => s.url === url)) return { ok: true };
    if (open.length >= 10) return bad(reply, 'There are already enough suggestions for this game', 429);
    const title = await schedule.videoTitle(url);
    db.prepare('INSERT INTO video_suggestions (team_id, game_id, url, title, sender_jersey, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(team.id, gameId, url, title, jersey, String(req.body?.note ?? '').trim().slice(0, 300) || null);
    return { ok: true };
  });

  // The coach takes a suggested video for the game, or turns it down.
  app.post('/api/video-suggestions/:id', coach, async (req, reply) => {
    const s = db.prepare('SELECT * FROM video_suggestions WHERE id = ?').get(req.params.id);
    if (!s) return bad(reply, 'Not found', 404);
    const accept = req.body?.decision === 'accept';
    db.transaction(() => {
      db.prepare('UPDATE video_suggestions SET status = ? WHERE id = ?').run(accept ? 'accepted' : 'rejected', s.id);
      if (accept) {
        db.prepare(`INSERT INTO game_videos (game_id, url, title, state) VALUES (?, ?, ?, 'confirmed')
          ON CONFLICT(game_id) DO UPDATE SET url = excluded.url, title = excluded.title, state = 'confirmed'`).run(s.game_id, s.url, s.title);
      }
    })();
    return { ok: true, video: schedule.videoOf(s.game_id) };
  });

  // Every linked team's games (Home: upcoming and recent), or one team's.
  app.get('/api/schedule', coach, async (req) => {
    const teamId = Number(req.query.team) || null;
    const teams = db.prepare('SELECT id, name, sv_link, sv_caption, sv_synced_at, sv_error FROM teams WHERE sv_ical IS NOT NULL' + (teamId ? ' AND id = ?' : '')).all(...(teamId ? [teamId] : []));
    const games = db.prepare(`SELECT s.*, t.name AS team_name FROM schedule s JOIN teams t ON t.id = s.team_id
      ${teamId ? 'WHERE s.team_id = ?' : ''} ORDER BY s.starts_at`).all(...(teamId ? [teamId] : [])).map(rowOut);
    return { teams, games, videoSearch: !!youtube };
  });

  app.put('/api/teams/:id/swissvolley', coach, async (req, reply) => {
    if (!db.prepare('SELECT id FROM teams WHERE id = ?').get(req.params.id)) return bad(reply, 'Not found', 404);
    try {
      return await schedule.connect(Number(req.params.id), req.body?.link, req.body?.pick ?? null);
    } catch (e) {
      return bad(reply, e.message, e.status ?? 502);
    }
  });

  app.delete('/api/teams/:id/swissvolley', coach, async (req) => {
    db.prepare('UPDATE teams SET sv_link = NULL, sv_ical = NULL, sv_team_id = NULL, sv_caption = NULL, sv_filter = NULL, sv_synced_at = NULL, sv_error = NULL WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM schedule WHERE team_id = ? AND match_id IS NULL').run(req.params.id);
    return { ok: true };
  });

  app.post('/api/teams/:id/swissvolley/sync', coach, async (req, reply) => {
    try {
      return { games: await schedule.sync(Number(req.params.id)) };
    } catch (e) {
      return bad(reply, e.message, 502);
    }
  });

  // A tagged match belongs to a game of the schedule (or no longer: match_id null).
  app.put('/api/schedule/:id/match', coach, async (req, reply) => {
    const r = db.prepare('SELECT * FROM schedule WHERE id = ?').get(req.params.id);
    if (!r) return bad(reply, 'Not found', 404);
    const matchId = req.body?.match_id ? Number(req.body.match_id) : null;
    db.prepare('UPDATE schedule SET match_id = ? WHERE id = ?').run(matchId, r.id);
    return rowOut(db.prepare('SELECT * FROM schedule WHERE id = ?').get(r.id));
  });

  // The other team's games this season (results, and videos found for them), for scouting.
  app.get('/api/schedule/:id/opponent', coach, async (req, reply) => {
    const r = db.prepare('SELECT * FROM schedule WHERE id = ?').get(req.params.id);
    if (!r) return bad(reply, 'Not found', 404);
    const opponent = r.side === 'home' ? r.away : r.home;
    if (!r.league_id) return { opponent, games: [] };
    try {
      const games = (await schedule.opponentGames(r.league_id, opponent))
        .sort((a, b) => (a.start < b.start ? 1 : -1))
        .map((g) => ({ ...g, video: schedule.videoOf(g.gameId) }));
      return { opponent, games };
    } catch (e) {
      return bad(reply, e.message, 502);
    }
  });

  // Search YouTube for a game (ours or another team's): { gameId, home, away, start }.
  app.post('/api/games/:gameId/video/search', coach, async (req, reply) => {
    const b = req.body ?? {};
    if (!b.home || !b.away || !b.start) return bad(reply, 'home, away and start are needed');
    try {
      return await schedule.searchVideo({ gameId: Number(req.params.gameId), home: String(b.home), away: String(b.away), start: String(b.start) });
    } catch (e) {
      return bad(reply, e.message, e.status ?? 502);
    }
  });

  // Confirm a video for a game (a found one or a pasted link), or say none of them is it.
  app.put('/api/games/:gameId/video', coach, async (req, reply) => {
    const gameId = Number(req.params.gameId);
    const b = req.body ?? {};
    const state = b.state === 'rejected' ? 'rejected' : 'confirmed';
    if (state === 'confirmed' && !/^https?:\/\//.test(String(b.url ?? ''))) return bad(reply, 'A video link is needed');
    db.prepare(`INSERT INTO game_videos (game_id, url, title, state) VALUES (?, ?, ?, ?)
      ON CONFLICT(game_id) DO UPDATE SET url = excluded.url, title = excluded.title, state = excluded.state`)
      .run(gameId, state === 'confirmed' ? String(b.url) : null, state === 'confirmed' ? String(b.title ?? '').slice(0, 200) || null : null, state);
    return schedule.videoOf(gameId);
  });
}

/** Keeps every linked team's schedule fresh: looks every hour, reads a calendar after 12 hours. */
export function startScheduleSync(db, schedule, log = console.log) {
  const tick = async () => {
    const due = db.prepare("SELECT id FROM teams WHERE sv_ical IS NOT NULL AND (sv_synced_at IS NULL OR sv_synced_at < datetime('now', '-12 hours'))").all();
    for (const t of due) await schedule.sync(t.id).catch(() => {});
  };
  const timer = setInterval(() => tick().catch((e) => log(e)), HOURS);
  timer.unref?.();
  setTimeout(() => tick().catch(() => {}), 60_000).unref?.();
  return () => clearInterval(timer);
}
