import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/index.js';
import { keyWords, parseIcs, parseLink, scoreVideo } from '../src/swissvolley.js';

// A team calendar as VolleyManager writes it (folded lines, escaped commas, a reminder block).
const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'NAME:#77 | VBC Musterdorf (2L\\,  ♀\\, SVRZ)', 'X-WR-CALNAME:#77 | VBC Musterdorf (2L\\,  ♀\\, SVRZ)',
  'BEGIN:VTIMEZONE', 'TZID:Europe/Zurich', 'END:VTIMEZONE',
  'BEGIN:VEVENT', 'UID:game-5001', 'SUMMARY:VBC Musterdorf - Volley Seetal (2L)',
  'DESCRIPTION:#5001 | 18.10.2026 16:30 | VBC Musterdorf — Volley Seetal\\n\\nResu',
  ' ltat: 3:1\\n\\nLiga: #900 | 2L | ♀\\n\\nHalle: Turnhalle Dorf\\nAdre', ' sse: Schulweg 1\\, 8000 Musterdorf',
  'DTSTART;TZID=Europe/Zurich:20261018T163000',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:reminder', 'END:VALARM', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:game-5002', 'SUMMARY:STV Bergli - VBC Musterdorf (2L)',
  'DESCRIPTION:#5002 | 06.12.2026 13:30 | STV Bergli — VBC Musterdorf\\n\\nLiga: #900 | 2L | ♀\\n\\nHalle: Bergli',
  'DTSTART;TZID=Europe/Zurich:20261206T133000', 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

test('Swiss Volley links and team calendars', () => {
  assert.deepEqual(parseLink('https://www.volleyball.ch/de/game-center/club/905280/team/91'), { clubId: 905280, teamId: 91 });
  assert.deepEqual(parseLink('webcal://volleymanager.volleyball.ch/iCal/schedule/68C6E7071D2F0C05D614573CF6E3022B28F7B761'),
    { ical: 'https://volleymanager.volleyball.ch/iCal/schedule/68c6e7071d2f0c05d614573cf6e3022b28f7b761' });
  assert.equal(parseLink('https://example.com'), null);
  const cal = parseIcs(ICS);
  assert.deepEqual(cal.team, { teamId: 77, caption: 'VBC Musterdorf', info: '2L, ♀, SVRZ' });
  assert.equal(cal.games.length, 2);
  assert.deepEqual(cal.games[0], { gameId: 5001, start: '2026-10-18T16:30', home: 'VBC Musterdorf', away: 'Volley Seetal', leagueId: 900, league: '2L',
    hall: 'Turnhalle Dorf', address: 'Schulweg 1, 8000 Musterdorf', result: '3:1', cancelled: false });
  assert.equal(cal.games[1].result, null, 'not played yet');
});

test('video candidates: both teams named, match length, near the date', () => {
  assert.deepEqual(keyWords("Sm`Aesch Pfeffingen"), ['aesch', 'pfeffingen']);
  assert.deepEqual(keyWords('Volley Lugano'), ['lugano']);
  const game = { home: 'Volley Lugano', away: 'BIWI VFM', start: '2026-10-18T16:30' };
  const full = scoreVideo({ title: 'Volley Lugano - BIWI VFM', seconds: 5400, publishedAt: '2026-10-18T14:00:00Z' }, game);
  const clip = scoreVideo({ title: 'Highlights Lugano VFM', seconds: 120, publishedAt: '2026-11-20T14:00:00Z' }, game);
  assert.ok(full > clip && clip >= 0);
  assert.equal(scoreVideo({ title: 'Volley Lugano training', seconds: 5400, publishedAt: '2026-10-18T14:00:00Z' }, game), 0, 'one team only');
  assert.ok(scoreVideo({ title: 'LUG VS VFM', channel: 'Volley Lugano Live', seconds: 7200, publishedAt: '2026-10-17T14:00:00Z' }, game) > 0, 'the channel names the club');
});

test('linking a team, its schedule, the opponent and video search', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-sv-'));
  const page = 'x:{"teamId":76,"seasonalTeamId":1,"caption":"Other","iCalUrl":{"translations":{"d":"webcal://volleymanager.volleyball.ch/iCal/schedule/aaaa0000aaaa0000aaaa"}}}'
    + '{"teamId":77,"seasonalTeamId":2,"caption":"VBC Musterdorf","iCalUrl":{"translations":{"d":"webcal://volleymanager.volleyball.ch/iCal/schedule/bbbb1111bbbb1111bbbb"}}}';
  const league = [
    { gameId: 5001, playDate: '2026-10-18 16:30:00', teams: { home: { teamId: 77, caption: 'VBC Musterdorf' }, away: { teamId: 78, caption: 'Volley Seetal' } }, league: { leagueId: 900, caption: '2L' }, resultSummary: { wonSetsHomeTeam: 3, wonSetsAwayTeam: 1 }, setResults: [{ home: 25, away: 20 }] },
    { gameId: 4990, playDate: '2026-10-11 18:00:00', teams: { home: { teamId: 79, caption: 'STV Bergli' }, away: { teamId: 78, caption: 'Volley Seetal' } }, league: { leagueId: 900, caption: '2L' }, resultSummary: { wonSetsHomeTeam: 0, wonSetsAwayTeam: 3 }, setResults: [] },
  ];
  const calls = [];
  const fake = async (url, o = {}) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, text: async () => body });
    if (url.includes('/club/1/team/77')) return ok(page);
    if (url.includes('iCal/schedule/bbbb')) return ok(ICS);
    if (url.endsWith('/de/game-center') && o.method === 'POST') {
      return o.headers['Next-Action'] === 'abc1234567abc1234567abc1234567abc1234567' ? ok(`0:["$@1"]\n1:${JSON.stringify(league)}\n`) : { ok: false, status: 404, text: async () => '' };
    }
    if (url.endsWith('/de/game-center')) return ok('<script src="/_next/static/chunks/page-1.js"></script>');
    if (url.includes('/_next/static/chunks/page-1.js')) return ok('var a=(0,l.$)("ffff234567abc1234567abc1234567abc1234567"),b=(0,l.$)("abc1234567abc1234567abc1234567abc1234567");');
    if (url.includes('youtube/v3/search')) return ok(JSON.stringify({ items: [{ id: { videoId: 'v1' } }, { id: { videoId: 'v2' } }] }));
    if (url.includes('youtube/v3/videos')) {
      return ok(JSON.stringify({ items: [
        { id: 'v1', snippet: { title: 'Highlights', channelTitle: 'Someone', publishedAt: '2026-10-11T20:00:00Z' }, contentDetails: { duration: 'PT2M' } },
        { id: 'v2', snippet: { title: 'STV Bergli vs Volley Seetal', channelTitle: 'STV Bergli', publishedAt: '2026-10-11T15:00:00Z' }, contentDetails: { duration: 'PT1H52M10S' } },
      ] }));
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') }, { scheduleFetch: fake, youtubeKey: 'KEY' });
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Damen 1' } })).json();
  const match = (await app.inject({ method: 'POST', url: '/api/matches', payload: { label: 'Heimspiel', team_id: team.id, opponent: 'Seetal', played_on: '2026-10-18' } })).json();

  assert.equal((await app.inject({ method: 'PUT', url: `/api/teams/${team.id}/swissvolley`, payload: { link: 'nonsense' } })).statusCode, 400);
  const linked = await app.inject({ method: 'PUT', url: `/api/teams/${team.id}/swissvolley`, payload: { link: 'https://www.volleyball.ch/de/game-center/club/1/team/77' } });
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal(linked.json().sv_caption, 'VBC Musterdorf');

  const sched = (await app.inject({ url: '/api/schedule' })).json();
  assert.equal(sched.games.length, 2);
  assert.equal(sched.videoSearch, true);
  const [first, second] = sched.games;
  assert.equal(first.side, 'home');
  assert.equal(second.side, 'away');
  assert.equal(first.match_id, match.id, 'the match tagged that day belongs to the game');
  assert.equal(second.match_id, null);

  // The other team's games, read from the league (the website call id is looked up first).
  const opp = (await app.inject({ url: `/api/schedule/${first.id}/opponent` })).json();
  assert.equal(opp.opponent, 'Volley Seetal');
  assert.deepEqual(opp.games.map((g) => [g.gameId, g.result]), [[5001, '3:1'], [4990, '0:3']]);
  const again = calls.length;
  await app.inject({ url: `/api/schedule/${first.id}/opponent` });
  assert.equal(calls.length, again, 'the league is kept for a while');

  // Videos: the full match is suggested, then confirmed.
  const found = (await app.inject({ method: 'POST', url: '/api/games/4990/video/search', payload: { home: 'STV Bergli', away: 'Volley Seetal', start: '2026-10-11T18:00' } })).json();
  assert.equal(found.state, 'found');
  assert.equal(found.url, 'https://www.youtube.com/watch?v=v2');
  assert.equal(found.candidates.length, 1, 'a clip without the team names is left out');
  const ok = (await app.inject({ method: 'PUT', url: '/api/games/4990/video', payload: { url: found.url, title: 'Bergli - Seetal' } })).json();
  assert.equal(ok.state, 'confirmed');
  assert.equal((await app.inject({ url: `/api/schedule/${first.id}/opponent` })).json().games[1].video.state, 'confirmed');

  // Unlinking keeps the game a match belongs to.
  await app.inject({ method: 'DELETE', url: `/api/teams/${team.id}/swissvolley` });
  assert.deepEqual((await app.inject({ url: '/api/schedule' })).json().games.map((g) => g.match_id), [match.id]);
  await app.close();
});

test('a club calendar: pick which of the club teams it is', async () => {
  const ev = (id, day, home, away, league) => [
    'BEGIN:VEVENT', `UID:game-${id}`, `DESCRIPTION:#${id} | ${day}.10.2026 18:00 | ${home} — ${away}\\n\\nLiga: #${league === 'U23' ? 2 : 1} | ${league} | ♀`,
    `DTSTART;TZID=Europe/Zurich:202610${day}T180000`, 'END:VEVENT'];
  const club = ['BEGIN:VCALENDAR', 'NAME:#900001 | VBC Muster',
    ...ev(1, 10, 'VBC Muster D1', 'Volley Nord', '2L'), ...ev(2, 11, 'Volley Süd', 'VBC Muster D1', '2L'),
    ...ev(3, 12, 'VBC Muster', 'STV Ost', '1L'), ...ev(4, 13, 'VBC Muster', 'Volley West', 'U23'), ...ev(5, 14, 'Volley Nord', 'VBC Muster', '1L'),
    'END:VCALENDAR'].join('\r\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-club-'));
  const fake = async (url) => (url.includes('iCal/schedule/cccc') ? { ok: true, status: 200, text: async () => club } : { ok: false, status: 404, text: async () => '' });
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') }, { scheduleFetch: fake, youtubeKey: null });
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Herren 1' } })).json();
  const link = 'webcal://volleymanager.volleyball.ch/iCal/schedule/cccc2222cccc2222cccc';
  const ask = (await app.inject({ method: 'PUT', url: `/api/teams/${team.id}/swissvolley`, payload: { link } })).json();
  assert.equal(ask.club, 'VBC Muster');
  assert.deepEqual(ask.choices.map((c) => [c.name, c.leagues, c.games]), [
    ['VBC Muster', null, 3], ['VBC Muster', ['1L'], 2], ['VBC Muster', ['U23'], 1], ['VBC Muster D1', null, 2],
  ]);
  assert.equal((await app.inject({ url: '/api/schedule' })).json().games.length, 0, 'nothing linked yet');
  const linked = (await app.inject({ method: 'PUT', url: `/api/teams/${team.id}/swissvolley`, payload: { link, pick: ask.choices[1] } })).json();
  assert.equal(linked.sv_caption, 'VBC Muster');
  const games = (await app.inject({ url: '/api/schedule' })).json().games;
  assert.deepEqual(games.map((g) => [g.game_id, g.side]), [[3, 'home'], [5, 'away']], 'only the 1L games of that team');
  await app.close();
});

test('team numbers are not search words', () => {
  assert.deepEqual(keyWords('Volley Oerlikon H2'), ['oerlikon']);
  assert.deepEqual(keyWords('OTA VOLLEY H1'), ['ota']);
  assert.deepEqual(keyWords('Volley Oerlikon DU23'), ['oerlikon', 'du23']);
});

test('public team page: games, confirmed videos only, and video suggestions from visitors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-pub-'));
  const fake = async (url) => {
    if (url.includes('iCal/schedule/bbbb')) return { ok: true, status: 200, text: async () => ICS };
    if (url.includes('youtube.com/oembed')) return { ok: true, status: 200, json: async () => ({ title: 'Musterdorf vs Seetal, full game' }) };
    return { ok: false, status: 404, text: async () => '' };
  };
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') }, { scheduleFetch: fake, youtubeKey: null });
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Damen 1' } })).json();
  await app.inject({ method: 'PUT', url: `/api/teams/${team.id}/swissvolley`, payload: { link: 'webcal://volleymanager.volleyball.ch/iCal/schedule/bbbb1111bbbb1111bbbb' } });
  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;

  // A found but unconfirmed video stays private.
  await app.inject({ method: 'PUT', url: '/api/games/5002/video', payload: { state: 'rejected' } });
  let pub = (await app.inject({ url: `/api/share/team/${token}/schedule` })).json();
  assert.deepEqual(pub.games.map((g) => [g.game_id, g.video]), [[5001, null], [5002, null]]);
  assert.equal((await app.inject({ url: '/api/share/team/wrong/schedule' })).statusCode, 404);

  const send = (payload, game = 5001) => app.inject({ method: 'POST', url: `/api/share/team/${token}/games/${game}/video`, payload });
  assert.equal((await send({ url: 'youtube.com/x', jersey: 7 })).statusCode, 400, 'full link needed');
  assert.equal((await send({ url: 'https://youtu.be/abc' })).statusCode, 400, 'shirt number needed');
  assert.equal((await send({ url: 'https://youtu.be/abc', jersey: 7 }, 9999)).statusCode, 404, 'not a game of this team');
  assert.equal((await send({ url: 'https://youtu.be/abc', jersey: 7, note: 'from the parents' })).statusCode, 200);
  assert.equal((await send({ url: 'https://youtu.be/abc', jersey: 12 })).statusCode, 200, 'the same link again is fine');

  const coachView = (await app.inject({ url: '/api/schedule' })).json().games.find((g) => g.game_id === 5001);
  assert.equal(coachView.suggestions.length, 1);
  const s = coachView.suggestions[0];
  assert.deepEqual([s.url, s.title, s.sender_jersey, s.note], ['https://youtu.be/abc', 'Musterdorf vs Seetal, full game', 7, 'from the parents']);

  const ok = (await app.inject({ method: 'POST', url: `/api/video-suggestions/${s.id}`, payload: { decision: 'accept' } })).json();
  assert.equal(ok.video.state, 'confirmed');
  pub = (await app.inject({ url: `/api/share/team/${token}/schedule` })).json();
  assert.deepEqual(pub.games[0].video, { state: 'confirmed', url: 'https://youtu.be/abc', title: 'Musterdorf vs Seetal, full game', candidates: [], searched_at: null });
  assert.equal((await app.inject({ url: '/api/schedule' })).json().games[0].suggestions.length, 0, 'decided');
  await app.close();
});

test('match center: any Swiss Volley game, by week or a region season, videos for any game', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-center-'));
  const g = (id, day, home, away, gender, done) => ({ gameId: id, playDate: `2026-10-${day} 18:00:00`, gender, teams: { home: { caption: home }, away: { caption: away } },
    league: { leagueId: 1, caption: '3L ' }, phase: { caption: 'Quali' }, group: { caption: 'Gruppe A' }, hall: { caption: 'Halle', city: 'Musterdorf' },
    resultSummary: done ? { wonSetsHomeTeam: 3, wonSetsAwayTeam: 0 } : [], setResults: done ? [{ home: 25, away: 20 }] : [] });
  const queries = [];
  const fake = async (url, o = {}) => {
    if (o.method === 'POST' && url.endsWith('/de/game-center')) {
      const q = JSON.parse(o.body)[0];
      queries.push(q);
      const list = q.includes('region=SVRZ') ? [g(7001, 20, 'VBC Muster H2', 'Volley Nord H1', 'm', true)] : [g(7001, 20, 'VBC Muster H2', 'Volley Nord H1', 'm', true), g(7002, 21, 'Volley Süd D1', 'STV Ost D2', 'f', false)];
      return { ok: true, status: 200, text: async () => `0:["$@1"]\n1:${JSON.stringify(list)}\n` };
    }
    if (url.endsWith('/de/game-center')) return { ok: true, status: 200, text: async () => '<script src="/_next/static/chunks/a.js"></script>' };
    if (url.includes('chunks/a.js')) return { ok: true, status: 200, text: async () => 'x=(0,l.$)("abc1234567abc1234567abc1234567abc1234567");dateStart' };
    return { ok: false, status: 404, text: async () => '' };
  };
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none') }, { scheduleFetch: fake, youtubeKey: null });
  const team = (await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Herren 2' } })).json();
  const token = (await app.inject({ method: 'POST', url: `/api/teams/${team.id}/share`, payload: {} })).json().share_token;

  const week = (await app.inject({ url: '/api/center?from=2026-10-19&to=2026-10-25' })).json();
  assert.equal(week.regions.length, 15);
  assert.deepEqual(week.games.map((x) => [x.gameId, x.gender, x.league, x.result, x.city]), [[7001, 'm', '3L', '3:0', 'Musterdorf'], [7002, 'f', '3L', null, 'Musterdorf']]);
  assert.equal(queries.at(-1), '?includeCup=1&dateStart=2026-10-19&dateEnd=2026-10-25');
  assert.equal((await app.inject({ url: '/api/center?from=2026-08-01&to=2027-07-31' })).statusCode, 400, 'a season only per region');
  assert.equal((await app.inject({ url: '/api/center?region=xx&from=2026-08-01&to=2027-07-31' })).statusCode, 400);
  const season = (await app.inject({ url: '/api/center?region=svrz&from=2026-08-01&to=2027-07-31' })).json();
  assert.equal(season.games.length, 1);
  assert.match(queries.at(-1), /^\?region=SVRZ&includeCup=1&dateStart=2026-08-01/);
  const n = queries.length;
  await app.inject({ url: '/api/center?region=svrz&from=2026-08-01&to=2027-07-31' });
  assert.equal(queries.length, n, 'kept for a while');

  // A visitor sends a video for a game of another team; the coach uses it; it shows publicly.
  assert.equal((await app.inject({ method: 'POST', url: `/api/share/team/${token}/games/7002/video`, payload: { url: 'https://example.com/v', jersey: 3 } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/api/share/team/${token}/games/9999/video`, payload: { url: 'https://example.com/v', jersey: 3 } })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/center?from=2026-10-19&to=2026-10-25' })).json().games[1].sent, 1);
  const { suggestions } = (await app.inject({ url: '/api/games/7002/video' })).json();
  await app.inject({ method: 'POST', url: `/api/video-suggestions/${suggestions[0].id}`, payload: { decision: 'accept' } });
  const pub = (await app.inject({ url: `/api/share/team/${token}/center?from=2026-10-19&to=2026-10-25` })).json();
  assert.equal(pub.games[1].videoState, 'confirmed');
  assert.equal((await app.inject({ url: `/api/share/team/${token}/games/7002/video` })).json().video.url, 'https://example.com/v');
  assert.equal((await app.inject({ url: `/api/share/team/nope/center?from=2026-10-19&to=2026-10-25` })).statusCode, 404);
  await app.close();
});
