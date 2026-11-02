// Team schedules from Swiss Volley, other teams' games and videos found for games.
import { requireCoach } from './auth.js';
import { allGames, clubTeams, fetchCalendar, findCalendar, findVideos, forTeam, isClubCalendar, leagueGames, parseLink, REGIONS } from './swissvolley.js';

const coach = { preHandler: requireCoach };
const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
const HOURS = 3600 * 1000;

/** First and last day of the season a date falls in (August to July). */
function season(date = new Date()) {
  const y = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
  return { from: `${y}-08-01`, to: `${y + 1}-07-31` };
}

export function makeSchedule(db, { fetchFn = fetch, youtubeKey = null, ytLimit = 10000, log = () => {} } = {}) {
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
  // YouTube's free quota: 10,000 units a day, counted by Google from midnight Pacific time.
  // A search costs 100 units, reading the found videos' details 1 more.
  const ytDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const SEARCH_UNITS = 101;
  function ytUsage() {
    const used = db.prepare('SELECT units FROM yt_usage WHERE day = ?').get(ytDay())?.units ?? 0;
    // The next midnight in Los Angeles.
    let reset = new Date(Math.ceil(Date.now() / 3600000) * 3600000);
    while (ytDay(reset) === ytDay()) reset = new Date(reset.getTime() + 3600000);
    return { enabled: !!youtubeKey, used, limit: ytLimit, left: Math.max(0, ytLimit - used), searchesLeft: Math.max(0, Math.floor((ytLimit - used) / SEARCH_UNITS)), resetsAt: reset.toISOString() };
  }
  const addUnits = (n) => db.prepare('INSERT INTO yt_usage (day, units) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET units = units + excluded.units').run(ytDay(), n);

  async function searchVideo(game) {
    if (!youtubeKey) throw Object.assign(new Error('Video search is not set up on the server (YOUTUBE_API_KEY in .env)'), { status: 503 });
    if (ytUsage().searchesLeft < 1) throw Object.assign(new Error("Today's YouTube searches are used up (they come back at midnight in California, 9:00 in Switzerland)"), { status: 429 });
    let found;
    try {
      found = await findVideos(game, { key: youtubeKey, fetchFn, onUnits: addUnits });
    } catch (e) {
      // Google says the quota is gone (e.g. the key is also used elsewhere): count the day as full.
      // 403 (quota exceeded) or 429 (too many requests): today's searches are used up.
      if (/answered (403|429)/.test(e.message)) {
        addUnits(Math.max(0, ytLimit - ytUsage().used));
        throw Object.assign(new Error("YouTube stopped: today's searches are used up (also counted are searches with the same key elsewhere). They come back at 9:00."), { status: 429 });
      }
      throw e;
    }
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

  /**
   * The match center: every Swiss Volley game in a period, in all of Switzerland (at most two
   * weeks) or in one region (up to a season). Kept for an hour, past weeks for a day.
   */
  async function center({ region, from, to }) {
    if (region && !REGIONS.some((r) => r.id === region)) throw Object.assign(new Error('Unknown region'), { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '') || to < from) throw Object.assign(new Error('from and to are needed (YYYY-MM-DD)'), { status: 400 });
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days > (region ? 400 : 31)) throw Object.assign(new Error(region ? 'At most a season at a time' : 'Pick a region to see more than a month'), { status: 400 });
    const key = `center:${region ?? 'all'}:${from}:${to}`;
    const past = to < new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const fresh = cache.get(key, past ? 24 * HOURS : HOURS);
    if (fresh) return fresh;
    try {
      const actionCache = { get: () => cache.get('action:games'), set: (id) => cache.set('action:games', id) };
      // A game does not say which region it belongs to: all of Switzerland is read region by
      // region (five at a time), so each game can carry its region.
      let games;
      if (region) {
        games = (await allGames({ region, from, to, fetchFn, cache: actionCache })).map((g) => ({ ...g, region }));
      } else {
        // The first one alone, so a stale call id is looked up again only once.
        const [first, ...rest] = REGIONS;
        const lists = [(await allGames({ region: first.id, from, to, fetchFn, cache: actionCache })).map((g) => ({ ...g, region: first.id }))];
        for (let i = 0; i < rest.length; i += 5) {
          lists.push(...await Promise.all(rest.slice(i, i + 5).map(async (r) => (await allGames({ region: r.id, from, to, fetchFn, cache: actionCache })).map((g) => ({ ...g, region: r.id })))));
        }
        const byId = new Map();
        for (const g of lists.flat()) if (!byId.has(g.gameId)) byId.set(g.gameId, g);
        games = [...byId.values()];
      }
      const seen = db.prepare(`INSERT INTO sv_games (game_id, starts_at, home, away, league) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET starts_at = excluded.starts_at, home = excluded.home, away = excluded.away, league = excluded.league, seen_at = datetime('now')`);
      db.transaction(() => { for (const g of games) seen.run(g.gameId, g.start, g.home, g.away, g.league); })();
      // Only what the list needs (a season of a region is over a thousand games).
      const slim = games.map(({ homeId, awayId, homeClub, awayClub, ...g }) => g);
      cache.set(key, slim);
      return slim;
    } catch (e) {
      const old = cache.get(key);
      if (old) return old;
      throw e;
    }
  }

  // ---------- the nightly video search for the teams you follow ----------
  const autoSettings = () => ({ on: true, perDay: 30, ...(cache.get('yt:auto') ?? {}) });

  /** The games worth searching now: your teams' played games, then the next opponents' recent games. */
  async function autoTargets() {
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 16);
    const now = new Date().toISOString().slice(0, 16);
    // Not searched yet, or searched without a find at least 3 days ago while the game is recent (streams come late).
    const due = (gameId, start) => {
      const v = db.prepare('SELECT state, searched_at FROM game_videos WHERE game_id = ?').get(gameId);
      if (!v?.searched_at) return !v || v.state === 'none';
      return v.state === 'none' && Date.now() - Date.parse(`${v.searched_at.replace(' ', 'T')}Z`) > 3 * 86400000 && start > new Date(Date.now() - 21 * 86400000).toISOString();
    };
    const out = [];
    const ours = db.prepare('SELECT * FROM schedule WHERE result IS NOT NULL AND starts_at >= ? AND starts_at <= ? ORDER BY starts_at DESC').all(since, now);
    for (const g of ours) if (g.home && g.away && due(g.game_id, g.starts_at)) out.push({ gameId: g.game_id, home: g.home, away: g.away, start: g.starts_at });
    // The next two opponents of every linked team, and their games of the last two months.
    for (const t of db.prepare('SELECT id FROM teams WHERE sv_ical IS NOT NULL').all()) {
      const next = db.prepare('SELECT * FROM schedule WHERE team_id = ? AND result IS NULL AND cancelled = 0 AND starts_at >= ? ORDER BY starts_at LIMIT 2').all(t.id, now);
      for (const n of next) {
        const opponent = n.side === 'home' ? n.away : n.home;
        if (!opponent || !n.league_id) continue;
        const games = await opponentGames(n.league_id, opponent).catch(() => []);
        for (const g of games) {
          if (g.result && g.start >= since && due(g.gameId, g.start) && !out.some((x) => x.gameId === g.gameId)) out.push({ gameId: g.gameId, home: g.home, away: g.away, start: g.start });
        }
      }
    }
    return out;
  }

  /** Searches up to the day's budget (keeping 10 searches for the coach); records what it did. */
  async function autoSearch() {
    const set = autoSettings();
    if (!youtubeKey || !set.on) return null;
    const budget = Math.min(set.perDay, ytUsage().searchesLeft - 10);
    const result = { day: ytDay(), at: new Date().toISOString(), searched: 0, found: 0, waiting: 0 };
    if (budget > 0) {
      const targets = await autoTargets();
      result.waiting = Math.max(0, targets.length - budget);
      for (const g of targets.slice(0, budget)) {
        try {
          const v = await searchVideo(g);
          result.searched++;
          if (v?.candidates?.length) result.found++;
        } catch (e) {
          result.error = e.message;
          break;
        }
      }
    }
    cache.set('yt:auto:last', result);
    log(`video search: ${result.searched} games searched, possible videos for ${result.found}`);
    return result;
  }

  return { sync, connect, league, opponentGames, center, videoOf, searchVideo, videoTitle, ytUsage, autoSettings, autoSearch, cache };
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
    // A game of this team, or any game seen in the match center.
    if (!db.prepare('SELECT 1 FROM schedule WHERE team_id = ? AND game_id = ?').get(team.id, gameId) && !db.prepare('SELECT 1 FROM sv_games WHERE game_id = ?').get(gameId)) {
      return bad(reply, 'Unknown game', 404);
    }
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

  // What is left of today's free YouTube quota.
  app.get('/api/youtube/usage', coach, async () => schedule.ytUsage());
  // The nightly search for the teams you follow: on/off, how many games a day, and its last run.
  app.get('/api/youtube/auto', coach, async () => ({ ...schedule.autoSettings(), last: schedule.cache.get('yt:auto:last') }));
  app.put('/api/youtube/auto', coach, async (req) => {
    const cur = schedule.autoSettings();
    const perDay = Number(req.body?.perDay);
    schedule.cache.set('yt:auto', { on: req.body?.on ?? cur.on, perDay: Number.isInteger(perDay) && perDay >= 1 && perDay <= 90 ? perDay : cur.perDay });
    return schedule.autoSettings();
  });
  app.post('/api/youtube/auto', coach, async (req, reply) => {
    try { return await schedule.autoSearch(); } catch (e) { return bad(reply, e.message, 502); }
  });

  // ---------- match center: every Swiss Volley game, filtered in the page ----------
  const centerQuery = (q) => ({ region: q.region || null, from: q.from, to: q.to });
  app.get('/api/center', coach, async (req, reply) => {
    try {
      const games = await schedule.center(centerQuery(req.query));
      const sent = new Map(db.prepare("SELECT game_id, COUNT(*) AS n FROM video_suggestions WHERE status = 'open' GROUP BY game_id").all().map((r) => [r.game_id, r.n]));
      const videos = new Map(db.prepare('SELECT game_id, state, searched_at FROM game_videos').all().map((r) => [r.game_id, r]));
      const ours = new Map(db.prepare('SELECT game_id, match_id FROM schedule WHERE match_id IS NOT NULL').all().map((r) => [r.game_id, r.match_id]));
      return {
        regions: REGIONS, videoSearch: !!youtube,
        games: games.map((g) => {
          const v = videos.get(g.gameId);
          return { ...g, videoState: v && (v.state === 'confirmed' || v.state === 'found') ? v.state : null, searched: !!v?.searched_at, sent: sent.get(g.gameId) ?? 0, match_id: ours.get(g.gameId) ?? null };
        }),
      };
    } catch (e) {
      return bad(reply, e.message, e.status ?? 502);
    }
  });
  app.get('/api/share/team/:token/center', async (req, reply) => {
    if (!shareTeam(req.params.token)) return bad(reply, 'Not found', 404);
    try {
      const games = await schedule.center(centerQuery(req.query));
      const videos = new Map(db.prepare("SELECT game_id, url, title FROM game_videos WHERE state = 'confirmed'").all().map((r) => [r.game_id, r]));
      return { regions: REGIONS, games: games.map((g) => ({ ...g, videoState: videos.has(g.gameId) ? 'confirmed' : null })) };
    } catch (e) {
      return bad(reply, e.message, e.status ?? 502);
    }
  });
  // One game's video: the coach sees all of it (and what visitors sent), visitors only a confirmed one.
  app.get('/api/games/:gameId/video', coach, async (req) => {
    const gameId = Number(req.params.gameId);
    return { video: schedule.videoOf(gameId), suggestions: db.prepare("SELECT id, url, title, sender_jersey, note, created_at FROM video_suggestions WHERE game_id = ? AND status = 'open' ORDER BY id").all(gameId) };
  });
  app.get('/api/share/team/:token/games/:gameId/video', async (req, reply) => {
    if (!shareTeam(req.params.token)) return bad(reply, 'Not found', 404);
    const v = schedule.videoOf(Number(req.params.gameId));
    return { video: v?.state === 'confirmed' ? { state: 'confirmed', url: v.url, title: v.title, candidates: [], searched_at: null } : null };
  });

  // ---------- the official result of a tagged match (its Swiss Volley game) ----------
  // Set scores from the league's games, turned into us : them with the side the team played.
  app.get('/api/matches/:id/official', coach, async (req, reply) => {
    const r = db.prepare('SELECT * FROM schedule WHERE match_id = ? ORDER BY id LIMIT 1').get(req.params.id);
    if (!r) return { linked: false };
    const game = { home: r.home, away: r.away, side: r.side, start: r.starts_at, league: r.league, result: r.result };
    if (!r.league_id || !r.result) return { linked: true, game, sets: [] };
    try {
      const g = (await schedule.league(r.league_id)).find((x) => x.gameId === r.game_id);
      const sets = (g?.sets ?? []).map((x, i) => {
        const [h, a] = x.split(':').map(Number);
        return { set: i + 1, us: r.side === 'away' ? a : h, them: r.side === 'away' ? h : a };
      });
      return { linked: true, game: { ...game, result: g?.result ?? r.result }, sets };
    } catch (e) {
      return bad(reply, e.message, 502);
    }
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
  // The video search runs once a YouTube day (it starts at midnight in California, 9:00 in Switzerland).
  const ytDayNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let searching = false;
  const videoTick = async () => {
    if (searching || schedule.cache.get('yt:auto:last')?.day === ytDayNow()) return;
    searching = true;
    try { await schedule.autoSearch(); } finally { searching = false; }
  };
  const vt = setInterval(() => videoTick().catch((e) => log(e)), HOURS);
  vt.unref?.();
  setTimeout(() => videoTick().catch(() => {}), 10 * 60 * 1000).unref?.();
  const tick = async () => {
    const due = db.prepare("SELECT id FROM teams WHERE sv_ical IS NOT NULL AND (sv_synced_at IS NULL OR sv_synced_at < datetime('now', '-12 hours'))").all();
    for (const t of due) await schedule.sync(t.id).catch(() => {});
  };
  const timer = setInterval(() => tick().catch((e) => log(e)), HOURS);
  timer.unref?.();
  setTimeout(() => tick().catch(() => {}), 60_000).unref?.();
  return () => { clearInterval(timer); clearInterval(vt); };
}
