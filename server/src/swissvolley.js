// Team schedules from Swiss Volley, other teams' games, and finding match videos on YouTube.
//
// Sources, from most to least stable:
// - The team calendar (iCal) that VolleyManager publishes for every team. It is made for
//   subscribing in a calendar app, so it stays put; it has every game with date, opponent,
//   hall, league and the result in sets.
// - The games of a whole league, read the way the volleyball.ch game center reads them. That
//   goes through the website's internal calls, whose ids change when the site is updated, so
//   they are looked up again by themselves when a call stops working.
// - YouTube search through the YouTube Data API (a free key from Google), for videos of a game.

const UA = 'VolleyIQ (team schedule; +https://github.com/fumeia/volleyiq)';
const SITE = 'https://www.volleyball.ch';
const ICAL = 'https://volleymanager.volleyball.ch/iCal/schedule/';

/** What a pasted link points to: a team page on volleyball.ch, or a team calendar. */
export function parseLink(input) {
  const s = String(input ?? '').trim();
  const cal = s.match(/iCal\/schedule\/([0-9a-f]{20,64})/i);
  if (cal) return { ical: ICAL + cal[1].toLowerCase() };
  const team = s.match(/\/club\/(\d+)\/team\/(\d+)/);
  if (team) return { clubId: Number(team[1]), teamId: Number(team[2]) };
  return null;
}

async function get(fetchFn, url, headers = {}) {
  const res = await fetchFn(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

/** The calendar link of a team, read from its page on volleyball.ch (which lists every team of the club). */
export async function findCalendar(clubId, teamId, fetchFn = fetch) {
  const raw = await get(fetchFn, `${SITE}/de/game-center/club/${clubId}/team/${teamId}`, { RSC: '1' });
  const s = raw.replace(/\\"/g, '"');
  const re = /"teamId":(\d+),"seasonalTeamId":\d+,"caption":"((?:[^"\\]|\\.)*)"/g;
  for (let m; (m = re.exec(s));) {
    if (Number(m[1]) !== teamId) continue;
    const rest = s.slice(re.lastIndex, re.lastIndex + 2000);
    const next = rest.indexOf('"teamId"');
    const cal = /iCal\/schedule\/([0-9a-f]+)/.exec(rest);
    if (cal && (next < 0 || cal.index < next)) return { ical: ICAL + cal[1], caption: JSON.parse(`"${m[2]}"`) };
  }
  throw new Error('This team was not found on the page. Copy the link while the team is open in the Swiss Volley game center.');
}

const unescape = (v) => v.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

/** Games from a VolleyManager team calendar. */
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const cal = {};
  const games = [];
  let ev = null, inner = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') { if (ev) games.push(toGame(ev)); ev = null; continue; }
    // Blocks inside a game (the reminder) have their own DESCRIPTION: skip them.
    if (ev && line.startsWith('BEGIN:')) { inner++; continue; }
    if (ev && line.startsWith('END:')) { inner = Math.max(0, inner - 1); continue; }
    if (inner) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [key, ...params] = line.slice(0, i).split(';');
    const value = unescape(line.slice(i + 1));
    const k = key.toUpperCase();
    if (ev) { if (!(k in ev)) ev[k] = { value, params }; } else if (!(k in cal)) cal[k] = value;
  }
  // "#91 | BIWI VFM (NLA,  ♀, SV)"
  const name = (cal['X-WR-CALNAME'] ?? cal.NAME ?? '').match(/^#(\d+)\s*\|\s*(.+?)\s*(?:\(([^)]*)\))?$/);
  return {
    team: name ? { teamId: Number(name[1]), caption: name[2], info: name[3]?.replace(/\s+/g, ' ').trim() ?? null } : null,
    games: games.filter((g) => g.gameId && g.start),
  };
}

function toGame(ev) {
  const desc = ev.DESCRIPTION?.value ?? '';
  const field = (label) => desc.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'))?.[1].trim() ?? null;
  // First line: "#400977 | 18.10.2026 16:30 | BIWI VFM — Volley Lugano"
  const head = desc.split('\n')[0].split('|').map((x) => x.trim());
  let [home, away] = (head[2] ?? '').split(/\s+—\s+/);
  if (!away) {
    // Fallback on the title: "Home - Away (League)"
    const t = (ev.SUMMARY?.value ?? '').replace(/\s*\([^)]*\)\s*$/, '');
    [home, away] = t.split(/\s+-\s+(?=[^-]+$)/);
  }
  const dt = ev.DTSTART?.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  const league = field('Liga')?.split('|').map((x) => x.trim());
  const result = field('Resultat');
  return {
    gameId: Number(ev.UID?.value.match(/(\d+)/)?.[1]) || null,
    start: dt ? `${dt[1]}-${dt[2]}-${dt[3]}T${dt[4] ?? '00'}:${dt[5] ?? '00'}` : null,
    home: home?.trim() ?? null,
    away: away?.trim() ?? null,
    leagueId: Number(league?.[0]?.replace('#', '')) || null,
    league: league?.[1] ?? null,
    hall: field('Halle'),
    address: field('Adresse') ?? ev.LOCATION?.value ?? null,
    result: result && /^\d+:\d+$/.test(result) ? result : null,
    cancelled: ev.STATUS?.value === 'CANCELLED',
  };
}

/**
 * The teams in a club calendar (every game has one of them): name, leagues and games, to pick
 * from. A name that plays in two leagues (e.g. a league and U23) is offered per league too;
 * cup games go with the league that is not a youth league.
 */
export function clubTeams(games) {
  const count = new Map();
  for (const g of games) for (const t of [g.home, g.away]) count.set(t, (count.get(t) ?? 0) + 1);
  const teams = new Map();
  for (const g of games) {
    const ours = (count.get(g.home) ?? 0) >= (count.get(g.away) ?? 0) ? g.home : g.away;
    if (!teams.has(ours)) teams.set(ours, new Map());
    const l = teams.get(ours);
    l.set(g.league ?? '', (l.get(g.league ?? '') ?? 0) + 1);
  }
  const cup = (l) => /cup/i.test(l);
  const youth = (l) => /^U\d+/i.test(l);
  const out = [];
  for (const [name, leagues] of teams) {
    const all = [...leagues.keys()];
    const n = (ls) => ls.reduce((a, l) => a + (leagues.get(l) ?? 0), 0);
    out.push({ name, leagues: null, label: `${name} (${all.filter(Boolean).join(', ')})`, games: n(all) });
    const main = all.filter((l) => l && !cup(l));
    if (main.length > 1) {
      for (const l of main) {
        const ls = youth(l) ? [l] : [l, ...all.filter(cup)];
        out.push({ name, leagues: ls, label: `${name}, only ${ls.join(' + ')}`, games: n(ls) });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || (a.leagues ? 1 : 0) - (b.leagues ? 1 : 0));
}

/** A club's calendar (not a single team's): its name has no "(league, …)" part and several teams play in it. */
export const isClubCalendar = (cal) => !cal.team?.info && clubTeams(cal.games).filter((t) => !t.leagues).length > 1;

/** Only this team's games: { name, leagues } picked from a club calendar. */
export const forTeam = (games, filter) => (filter ? games.filter((g) => (g.home === filter.name || g.away === filter.name) && (!filter.leagues || filter.leagues.includes(g.league))) : games);

export async function fetchCalendar(ical, fetchFn = fetch) {
  return parseIcs(await get(fetchFn, ical, { Accept: 'text/calendar' }));
}

// ---------- games of a whole league (the game center's own calls) ----------

/** The answer of a website call: line "1:" holds the data. */
function actionData(text) {
  const line = text.split('\n').find((l) => l.startsWith('1:'));
  return line ? JSON.parse(line.slice(2)) : null;
}

async function callAction(fetchFn, id, arg) {
  const res = await fetchFn(`${SITE}/de/game-center`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Next-Action': id, Accept: 'text/x-component', 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify([arg]),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return null;
  try { return actionData(await res.text()); } catch { return null; }
}

/** Looks up the id of the website's "games" call: tries the call ids in the game center's scripts. */
export async function discoverGamesAction(fetchFn = fetch, probeArg) {
  const html = await get(fetchFn, `${SITE}/de/game-center`);
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"']+\.js/g) ?? [])];
  const likely = [], other = [];
  for (const c of chunks) {
    const js = await get(fetchFn, SITE + c).catch(() => '');
    const found = [...js.matchAll(/\(0,\w+\.\$\)\("([0-9a-f]{40,42})"\)|createServerReference\)\("([0-9a-f]{40,42})"/g)].map((m) => m[1] ?? m[2]);
    // The script that builds the games query holds the call: try its ids first.
    (/dateStart|includeCup/.test(js) ? likely : other).push(...found);
  }
  for (const id of new Set([...likely, ...other])) {
    const data = await callAction(fetchFn, id, probeArg).catch(() => null);
    if (Array.isArray(data) && data[0]?.gameId) return id;
  }
  throw new Error('The Swiss Volley game center could not be read (it may have changed)');
}

const simpleGame = (g) => ({
  gameId: g.gameId,
  start: g.playDate ? g.playDate.slice(0, 16).replace(' ', 'T') : null,
  home: g.teams?.home?.caption ?? null,
  away: g.teams?.away?.caption ?? null,
  homeId: g.teams?.home?.teamId ?? null,
  awayId: g.teams?.away?.teamId ?? null,
  homeClub: Number(g.teams?.home?.clubId) || null,
  awayClub: Number(g.teams?.away?.clubId) || null,
  leagueId: g.league?.leagueId ?? null,
  league: g.league?.caption ?? null,
  group: g.group?.caption ?? null,
  hall: g.hall?.caption ?? null,
  result: g.resultSummary && Number.isFinite(g.resultSummary.wonSetsHomeTeam) ? `${g.resultSummary.wonSetsHomeTeam}:${g.resultSummary.wonSetsAwayTeam}` : null,
  sets: Array.isArray(g.setResults) ? g.setResults.filter((s) => Number.isFinite(s?.home)).map((s) => `${s.home}:${s.away}`) : [],
});

/**
 * All games of a league (between [from] and [to], YYYY-MM-DD). [cache] keeps the call id
 * ({ get(), set(id) }); a stale id is replaced by looking it up again once.
 */
export async function leagueGames(leagueId, { from, to, fetchFn = fetch, cache }) {
  if (!leagueId) throw new Error('No league');
  const arg = `?leagueId=${leagueId}&includeCup=1&dateStart=${from}&dateEnd=${to}`;
  let id = cache?.get();
  let data = id ? await callAction(fetchFn, id, arg).catch(() => null) : null;
  // An unknown call id answers with an error or nothing; an empty league is an empty list.
  if (!Array.isArray(data)) {
    id = await discoverGamesAction(fetchFn, arg);
    cache?.set(id);
    data = await callAction(fetchFn, id, arg);
  }
  if (!Array.isArray(data)) throw new Error('The Swiss Volley game center could not be read');
  return data.map(simpleGame);
}

// ---------- videos on YouTube ----------

// Words in many club names that say nothing about which club it is.
const COMMON = new Set(['vbc', 'vc', 'tv', 'stv', 'sv', 'volley', 'volleyball', 'club', 'team', 'damen', 'herren', 'frauen', 'manner', 'maenner',
  'juniorinnen', 'junioren', 'les', 'de', 'du', 'la', 'le', 'des', 'et', 'und', 'the', 'nla', 'nlb', 'lna', 'lnb', 'sm']);
const words = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
/** The words that identify a team, e.g. "Volley Lugano" → ["lugano"]. */
// Team numbers (H2, D1, U23) are left out too: titles often skip them.
export const keyWords = (name) => { const w = words(name); const k = w.filter((x) => !COMMON.has(x) && !/^\d+$/.test(x) && !/^[hdu]\d{1,2}$/.test(x)); return k.length ? k : w; };

const isoDuration = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d ?? ''); return m ? (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) : 0; };

/** How well a video fits a game: both teams named, long enough for a match, published around the date. */
export function scoreVideo(v, game) {
  const title = new Set(words(`${v.title} ${v.channel ?? ''} ${v.description ?? ''}`));
  const hits = (name) => keyWords(name).filter((w) => title.has(w)).length;
  const h = hits(game.home), a = hits(game.away);
  if (!h || !a) return 0;
  let score = 2 + Math.min(h, 2) + Math.min(a, 2);
  if (v.seconds >= 45 * 60) score += 3; else if (v.seconds >= 20 * 60) score += 1; else if (v.seconds && v.seconds < 5 * 60) score -= 3;
  const days = Math.abs((Date.parse(v.publishedAt) - Date.parse(game.start)) / 86400000);
  if (days <= 1.5) score += 2; else if (days <= 7) score += 1;
  return score;
}

/** Videos that may show [game] ({ home, away, start }), best first. Needs a YouTube Data API key. */
export async function findVideos(game, { key, fetchFn = fetch }) {
  const day = Date.parse(game.start);
  const params = new URLSearchParams({
    part: 'snippet', type: 'video', maxResults: '15', key,
    q: `${keyWords(game.home).join(' ')} ${keyWords(game.away).join(' ')} volleyball`,
    // A live stream is often created days before the game.
    publishedAfter: new Date(day - 10 * 86400000).toISOString(),
    publishedBefore: new Date(day + 21 * 86400000).toISOString(),
  });
  const search = JSON.parse(await get(fetchFn, `https://www.googleapis.com/youtube/v3/search?${params}`));
  const ids = (search.items ?? []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const details = JSON.parse(await get(fetchFn, `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'snippet,contentDetails', id: ids.join(','), key })}`));
  return (details.items ?? [])
    .map((v) => ({
      id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, title: v.snippet?.title ?? '', channel: v.snippet?.channelTitle ?? '',
      description: (v.snippet?.description ?? '').slice(0, 300), publishedAt: v.snippet?.publishedAt, seconds: isoDuration(v.contentDetails?.duration),
    }))
    .map((v) => ({ ...v, score: scoreVideo(v, game) }))
    .filter((v) => v.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 5)
    .map(({ description, ...v }) => v);
}
