import type { ActionCode, RoleCode } from './actions';
import type { Calibration } from './calibration';
import type { Lineups } from './rotation';
import type { MatchSheetFlow, SheetSet } from './sheetFlow';
import type { VideoLink } from './videoQuality';

export interface VideoJob { state: 'queued' | 'running' | 'paused' | 'done' | 'failed'; progress: number; error: string | null; updated_at: string; ahead: number }

export interface Team {
  id: number; name: string; coach: string | null; player_count?: number; share_token?: string | null; show_tips?: number;
  /** Linked to Swiss Volley: the pasted link, the team's name there, last read, last error. */
  sv_link?: string | null; sv_caption?: string | null; sv_synced_at?: string | null; sv_error?: string | null;
}
/** A video found (or chosen) for a game. */
export interface GameVideo { state: 'none' | 'found' | 'confirmed' | 'rejected'; url: string | null; title: string | null; searched_at: string | null;
  candidates: { id: string; url: string; title: string; channel: string; publishedAt: string; seconds: number; score: number }[] }
/** A team in a club calendar: its name there, and only some of its leagues (null: all). */
export interface ClubTeamChoice { name: string; leagues: string[] | null; label: string; games: number }
/** A game from a team's Swiss Volley schedule. */
export interface ScheduleGame {
  id: number; team_id: number; team_name: string; game_id: number; starts_at: string; home: string | null; away: string | null;
  side: 'home' | 'away' | null; league: string | null; league_id: number | null; hall: string | null; address: string | null;
  result: string | null; cancelled: boolean; match_id: number | null; video: GameVideo | null;
  /** Videos suggested by visitors of the public page, waiting for the coach (coach view only). */
  suggestions?: VideoSuggestion[];
}
export interface VideoSuggestion { id: number; url: string; title: string | null; sender_jersey: number | null; note: string | null; created_at: string }
/** A game in the match center (any Swiss Volley game). */
export interface CenterGame {
  gameId: number; start: string; home: string; away: string; leagueId: number | null; league: string | null; phase: string | null; group: string | null;
  gender: 'f' | 'm' | 'mixed' | null; hall: string | null; city: string | null; result: string | null; sets: string[];
  videoState: 'confirmed' | 'found' | null; searched?: boolean; sent?: number; match_id?: number | null;
}
/** Today's YouTube quota: units used and left (a search costs 101), and when it starts over. */
export interface YoutubeUsage { enabled: boolean; used: number; limit: number; left: number; searchesLeft: number; resetsAt: string }
export interface CenterQuery { region?: string | null; from: string; to: string }
const centerQs = (q: CenterQuery) => new URLSearchParams({ ...(q.region ? { region: q.region } : {}), from: q.from, to: q.to }).toString();
/** Any game of a league (other teams' games too). */
export interface LeagueGame { gameId: number; start: string; home: string; away: string; league: string | null; group: string | null; hall: string | null; result: string | null; sets: string[]; video: GameVideo | null }
export interface Player { id: number; team_id: number; name: string; number: number | null; role: RoleCode; active: number }
export interface Match {
  id: number; team_id: number | null; team_name?: string | null; label: string; opponent: string | null;
  played_on: string | null; mode: 'video' | 'live'; video_type: 'youtube' | 'upload' | 'local' | null;
  video_ref: string | null; share_token: string | null;
  calibration?: Calibration | null; lineups?: Lineups | null; sheet?: MatchSheetFlow | null; created_at?: string; event_count?: number; suggested_count?: number;
  /** Analyst effort: active seconds, and auto suggestions corrected / removed / saved (matches list only for the counts). */
  work_sec?: number; edited_count?: number; removed_count?: number; confirmed_count?: number; auto_confirmed_count?: number;
  /** The match video in the team's storage (bucket key, size). */
  video_key?: string | null; video_bytes?: number | null;
  /** Corrections from viewers of the public link waiting for a decision (matches list). */
  open_edits?: number;
  /** Public link only: which video goes with the match (in the team's storage, a YouTube id, or the name of the coach's file). */
  video?: { type: 'hosted' } | { type: 'youtube'; id: string } | { type: 'file'; name: string } | null;
}
export interface VEvent {
  id: number; match_id: number; player_id: number | null; jersey: number | null; action: ActionCode;
  value: number | null; zone: number | null; x: number | null; y: number | null;
  /** Where the ball was played from (x, y: where it went). */
  fx?: number | null; fy?: number | null; rally?: number | null; poss?: number | null; t: number | null; set_no: number | null;
  source: 'manual' | 'auto'; status: 'confirmed' | 'suggested'; confidence: number | null; client_id?: string | null;
  /** Auto suggestions only: 'quiet' = faint sound in a hole of the rally, 'gap' = guessed from the rally rhythm. */
  hint?: 'quiet' | 'gap' | null;
  /** The AI check's answer for this suggestion, kept until the rally is reviewed. */
  ai?: AiTouch | null;
}
export type AiPosition = 'front-left' | 'front-middle' | 'front-right' | 'back-left' | 'back-middle' | 'back-right' | 'unsure';
/** The AI check's answer for one touch (i = its place in the request, from 1). */
export interface AiTouch {
  i: number; contact: 'yes' | 'no' | 'unsure'; team: 'ours' | 'theirs' | 'unsure'; action: string; jersey: number | null;
  position?: AiPosition; confidence: number;
  /** Which half our team was on when it was asked (needed to turn the position into a player). */
  ourSide?: 'near' | 'far' | null;
}
/** The tag fields a viewer of the public link can correct. */
export type EditFields = Partial<Pick<VEvent, 'action' | 'value' | 'player_id' | 'x' | 'y' | 'fx' | 'fy' | 't' | 'set_no'>>;
/** A correction sent from the public link, for the coach to accept or reject. */
export interface EditSuggestion {
  id: number; match_id: number; match_label: string; event_id: number | null;
  changes: EditFields; original: EditFields; note: string | null; name: string | null;
  /** Shirt number of whoever sent it. */
  sender_jersey: number | null;
  status: 'open' | 'accepted' | 'rejected'; created_at: string;
  /** 'add': a touch that was not tagged ([changes] has all its fields, with t and set_no). */
  kind: 'edit' | 'add';
  /** The tag as it is now (null when it was deleted since). */
  event: VEvent | null;
}
export type AiField = 'contact' | 'team' | 'action' | 'jersey' | 'position';
/** How often each answered field turned out right, over its recent answers (sure = confidence 0.6+). */
export type AiStats = Record<AiField, { n: number; correct: number; sureN: number; sureCorrect: number }>;
export interface AiBudget {
  currency: string;
  source: 'gateway' | 'server' | null;
  spend: number | null; max: number | null; remaining: number | null; resetAt: string | null;
  monthCalls: number;
  perTouch: number | null;
  today: { used: number; limit: number };
  maxTouches: number; maxExamples: number;
}
export interface AiExampleLabel { contact: 'yes' | 'no'; team: 'ours' | 'theirs' | 'unsure'; action: string; jersey: number | null; ourSide: 'near' | 'far' | null }
/** A saved state of a match's tagging; auto = saved by the app before a restore. */
/** The newest app of a release channel, as the server found it on GitHub. */
export interface AppRelease { version: string; name: string | null; notes: string; published: string | null; size: number; assetId: number }
export interface MatchVersion { id: number; label: string; auto: number; event_count: number; created_at: string }
export interface MatchBundle { match: Match; players: Player[]; events: VEvent[] }

/** Summary fields read off a photo of an official match sheet (best-effort). */
export interface SheetPlayer { number: number | null; name: string; role?: string | null; captain: boolean; libero: boolean }
export interface MatchSheet {
  teams: { A: string | null; B: string | null };
  date: string | null; time?: string | null; venue?: string | null; league: string | null; matchNo: string | null;
  winner: 'A' | 'B' | null; setsWon: { A: number; B: number } | null;
  sets: { a: number; b: number }[];
  rosters: { A: SheetPlayer[]; B: SheetPlayer[] };
  /** Per set: starting six, substitutions, service rounds and time-outs of both teams. */
  flow?: SheetSet[];
  confidence: 'high' | 'medium' | 'low';
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * The website talks to its own origin with a cookie. The Android app bundles
 * the UI, so it needs the server address and sends the session as a bearer token.
 */
const SERVER_KEY = 'viq:server';
const TOKEN_KEY = 'viq:token';

function store(key: string, value?: string | null) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
  return null;
}

export const isApp = () => !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
export const serverBase = () => (isApp() ? (store(SERVER_KEY) ?? '').replace(/\/+$/, '') : '');
export const setServerBase = (url: string) => store(SERVER_KEY, url.trim().replace(/\/+$/, ''));
export const publicBase = () => serverBase() || location.origin;
const token = () => store(TOKEN_KEY);
/** The app's login token, for native downloads from the server (the in-app update). */
export const authToken = () => token();

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(serverBase() + url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: isApp() ? 'omit' : 'same-origin',
    });
  } catch (err) {
    // Offline: show the last copy we saw, so the app still opens courtside.
    const cached = method === 'GET' ? store(`viq:cache:${url}`) : null;
    if (cached) return JSON.parse(cached);
    throw new ApiError(0, 'No connection to the server');
  }
  if (res.status === 401 && !url.startsWith('/api/login')) window.dispatchEvent(new Event('viq:unauthorized'));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? res.statusText);
  }
  const data = await res.json();
  if (method === 'GET' && isApp()) {
    try { localStorage.setItem(`viq:cache:${url}`, JSON.stringify(data)); } catch { /* full */ }
  }
  return data;
}

export const api = {
  me: () => req<{ authenticated: boolean; passwordRequired: boolean }>('GET', '/api/me'),
  async login(password: string) {
    const r = await req<{ token: string }>('POST', '/api/login', { password });
    if (isApp()) store(TOKEN_KEY, r.token);
    return r;
  },
  async logout() {
    store(TOKEN_KEY, null);
    await req('POST', '/api/logout', {}).catch(() => {});
  },
  token,

  teams: () => req<Team[]>('GET', '/api/teams'),
  team: (id: number) => req<Team & { players: Player[] }>('GET', `/api/teams/${id}`),
  createTeam: (name: string) => req<Team>('POST', '/api/teams', { name }),
  updateTeam: (id: number, data: Partial<Team>) => req<Team>('PATCH', `/api/teams/${id}`, data),
  deleteTeam: (id: number) => req('DELETE', `/api/teams/${id}`),
  addPlayer: (teamId: number, p: Partial<Player>) => req<Player>('POST', `/api/teams/${teamId}/players`, p),
  updatePlayer: (id: number, p: Partial<Player>) => req<Player>('PATCH', `/api/players/${id}`, p),
  deletePlayer: (id: number) => req('DELETE', `/api/players/${id}`),
  teamReport: (id: number) => req<{ team: Team; players: Player[]; matches: Match[]; events: VEvent[] }>('GET', `/api/teams/${id}/report`),

  matches: () => req<Match[]>('GET', '/api/matches'),
  match: (id: number) => req<MatchBundle>('GET', `/api/matches/${id}`),
  createMatch: (m: Partial<Match>) => req<Match>('POST', '/api/matches', m),
  schedule: (teamId?: number) => req<{ teams: Team[]; games: ScheduleGame[]; videoSearch: boolean }>('GET', `/api/schedule${teamId ? `?team=${teamId}` : ''}`),
  /** A club calendar answers with the club's teams to pick from; with [pick], the team is linked. */
  linkSwissVolley: (teamId: number, link: string, pick?: ClubTeamChoice) =>
    req<Team | { club: string | null; choices: ClubTeamChoice[] }>('PUT', `/api/teams/${teamId}/swissvolley`, { link, pick }),
  unlinkSwissVolley: (teamId: number) => req<{ ok: boolean }>('DELETE', `/api/teams/${teamId}/swissvolley`),
  syncSchedule: (teamId: number) => req<{ games: number }>('POST', `/api/teams/${teamId}/swissvolley/sync`),
  scheduleMatch: (id: number, matchId: number | null) => req<ScheduleGame>('PUT', `/api/schedule/${id}/match`, { match_id: matchId }),
  opponentGames: (id: number) => req<{ opponent: string; games: LeagueGame[] }>('GET', `/api/schedule/${id}/opponent`),
  searchVideo: (gameId: number, g: { home: string; away: string; start: string }) => req<GameVideo>('POST', `/api/games/${gameId}/video/search`, g),
  youtubeUsage: () => req<YoutubeUsage>('GET', '/api/youtube/usage'),
  center: (q: CenterQuery) => req<{ games: CenterGame[]; regions: { id: string; label: string }[]; videoSearch: boolean }>('GET', `/api/center?${centerQs(q)}`),
  sharedCenter: (token: string, q: CenterQuery) => req<{ games: CenterGame[]; regions: { id: string; label: string }[] }>('GET', `/api/share/team/${token}/center?${centerQs(q)}`),
  gameVideo: (gameId: number) => req<{ video: GameVideo | null; suggestions: VideoSuggestion[] }>('GET', `/api/games/${gameId}/video`),
  sharedGameVideo: (token: string, gameId: number) => req<{ video: GameVideo | null }>('GET', `/api/share/team/${token}/games/${gameId}/video`),
  sharedSchedule: (token: string) => req<{ games: ScheduleGame[] }>('GET', `/api/share/team/${token}/schedule`),
  suggestVideo: (token: string, gameId: number, s: { url: string; jersey: number; note?: string }) => req<{ ok: boolean }>('POST', `/api/share/team/${token}/games/${gameId}/video`, s),
  decideVideoSuggestion: (id: number, decision: 'accept' | 'reject') => req<{ ok: boolean; video: GameVideo | null }>('POST', `/api/video-suggestions/${id}`, { decision }),
  setVideo: (gameId: number, v: { url?: string; title?: string; state?: 'confirmed' | 'rejected' }) => req<GameVideo>('PUT', `/api/games/${gameId}/video`, v),
  updateMatch: (id: number, m: Partial<Match>) => req<Match>('PATCH', `/api/matches/${id}`, m),
  versions: (id: number) => req<MatchVersion[]>('GET', `/api/matches/${id}/versions`),
  saveVersion: (id: number, label: string) => req<MatchVersion[]>('POST', `/api/matches/${id}/versions`, { label }),
  restoreVersion: (id: number, vid: number) => req<MatchBundle & { versions: MatchVersion[] }>('POST', `/api/matches/${id}/versions/${vid}/restore`, {}),
  deleteVersion: (id: number, vid: number) => req<MatchVersion[]>('DELETE', `/api/matches/${id}/versions/${vid}`),
  deleteMatch: (id: number) => req('DELETE', `/api/matches/${id}`),
  share: (id: number, revoke = false) => req<{ share_token: string | null }>('POST', `/api/matches/${id}/share`, { revoke }),
  shared: (token: string) => req<MatchBundle>('GET', `/api/share/${token}`),
  shareTeam: (id: number, revoke = false) => req<{ share_token: string | null }>('POST', `/api/teams/${id}/share`, { revoke }),
  sharedTeam: (token: string) => req<{ team: Pick<Team, 'id' | 'name' | 'show_tips'>; players: Player[]; matches: Match[]; events: VEvent[] }>('GET', `/api/share/team/${token}`),

  addEvent: (matchId: number, e: Partial<VEvent>) => req<VEvent>('POST', `/api/matches/${matchId}/events`, e),
  updateEvent: (id: number, e: Partial<VEvent>) => req<VEvent>('PATCH', `/api/events/${id}`, e),
  deleteEvent: (id: number) => req('DELETE', `/api/events/${id}`),
  addWork: (matchId: number, sec: number) => req<{ work_sec: number }>('POST', `/api/matches/${matchId}/work`, { sec }),
  matchsheetEnabled: () => req<{ enabled: boolean }>('GET', '/api/matchsheet/enabled'),
  scanMatchsheet: (images: { media_type: string; data: string }[]) =>
    req<{ data: MatchSheet }>('POST', '/api/matchsheet/scan', { images }),
  insightsEnabled: () => req<{ enabled: boolean }>('GET', '/api/insights/enabled'),
  health: () => req<{ ok: boolean; version?: string }>('GET', '/api/health'),
  about: () => req<{ ai: { scan: boolean; summary: boolean; touches: boolean; model: string | null }; updates: { configured: boolean; repo: string | null } }>('GET', '/api/about'),
  appUpdate: (channel: 'stable' | 'test') => req<{ configured: boolean; channel?: string; latest: AppRelease | null }>('GET', `/api/app/update?channel=${channel}`),
  touchCheckEnabled: () => req<{ enabled: boolean; model: string | null }>('GET', '/api/ai/touches/enabled'),
  touchCheck: (body: { images: { media_type: string; data: string }[]; ourSide: 'near' | 'far' | null; roster: { number: number; role: string }[]; examples?: boolean }) =>
    req<{ touches: AiTouch[]; examples?: number }>('POST', '/api/ai/touches', body),
  saveAi: (matchId: number, results: { id: number; ai: AiTouch | null }[]) => req<{ updated: number }>('POST', `/api/matches/${matchId}/ai`, { results }),
  aiFeedback: (items: { field: AiField; confidence: number; correct: boolean }[]) => req<{ saved: number }>('POST', '/api/ai/feedback', { items }),
  aiStats: () => req<{ fields: AiStats; examples: number }>('GET', '/api/ai/stats'),
  aiExample: (image: string, label: AiExampleLabel) => req<{ ok: boolean }>('POST', '/api/ai/examples', { image, label }),
  clearAiExamples: () => req<{ deleted: number }>('DELETE', '/api/ai/examples'),
  sendEdit: (token: string, body: { event_id?: number; kind?: 'add'; match_id?: number; t?: number; changes: EditFields; note: string; jersey: number }) => req<{ id: number }>('POST', `/api/share/team/${token}/edits`, body),
  edits: (matchId?: number, status: 'open' | 'accepted' | 'rejected' = 'open') =>
    req<EditSuggestion[]>('GET', `/api/edits?status=${status}${matchId ? `&match_id=${matchId}` : ''}`),
  decideEdit: (id: number, decision: 'accept' | 'reject') => req<{ ok: boolean; event: VEvent | null }>('POST', `/api/edits/${id}/${decision}`),
  detectionRuns: (matchId: number) => req<import('./detectionReport').DetectionRun[]>('GET', `/api/matches/${matchId}/runs`),
  videoEnabled: () => req<{ enabled: boolean }>('GET', '/api/video/enabled'),
  videoUrl: (matchId: number) => req<VideoLink>('GET', `/api/matches/${matchId}/video/url`),
  /** The server's conversion into 720p and 480p (null: never asked for, e.g. uploaded before it existed). */
  videoStatus: (matchId: number) => req<{ job: VideoJob | null; hours: string | null }>('GET', `/api/matches/${matchId}/video/status`),
  convertVideo: (matchId: number) => req<{ ok: boolean }>('POST', `/api/matches/${matchId}/video/convert`),
  deleteVideo: (matchId: number) => req<{ ok: boolean }>('DELETE', `/api/matches/${matchId}/video`),
  sharedVideo: (token: string, matchId: number) => req<VideoLink>('GET', `/api/share/team/${token}/video/${matchId}`),
  aiBudget: () => req<AiBudget>('GET', '/api/ai/budget'),
  insightsSummary: (stats: unknown, lang: 'en' | 'de') =>
    req<{ bullets: string[] }>('POST', '/api/insights/summary', { stats, lang }),
  bulkEvents: (matchId: number, op: 'confirm' | 'delete', ids: number[]) =>
    req('POST', `/api/matches/${matchId}/events/bulk`, { op, ids }),
  clearSuggestions: (matchId: number) => req<{ deleted: number }>('POST', `/api/matches/${matchId}/suggestions/clear`),
};
