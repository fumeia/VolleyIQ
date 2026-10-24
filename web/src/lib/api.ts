import type { ActionCode, RoleCode } from './actions';

export interface Team { id: number; name: string; coach: string | null; player_count?: number; share_token?: string | null }
export interface Player { id: number; team_id: number; name: string; number: number | null; role: RoleCode; active: number }
export interface Match {
  id: number; team_id: number | null; team_name?: string | null; label: string; opponent: string | null;
  played_on: string | null; mode: 'video' | 'live'; video_type: 'youtube' | 'upload' | 'local' | null;
  video_ref: string | null; share_token: string | null;
  calibration?: { corners: [number, number][]; ourHalf: 'near' | 'far' } | null; created_at?: string; event_count?: number; suggested_count?: number;
}
export interface VEvent {
  id: number; match_id: number; player_id: number | null; jersey: number | null; action: ActionCode;
  value: number | null; zone: number | null; x: number | null; y: number | null; rally?: number | null; poss?: number | null; t: number | null; set_no: number | null;
  source: 'manual' | 'auto'; status: 'confirmed' | 'suggested'; confidence: number | null; client_id?: string | null;
}
export interface MatchBundle { match: Match; players: Player[]; events: VEvent[] }

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
  updateMatch: (id: number, m: Partial<Match>) => req<Match>('PATCH', `/api/matches/${id}`, m),
  deleteMatch: (id: number) => req('DELETE', `/api/matches/${id}`),
  share: (id: number, revoke = false) => req<{ share_token: string | null }>('POST', `/api/matches/${id}/share`, { revoke }),
  shared: (token: string) => req<MatchBundle>('GET', `/api/share/${token}`),
  shareTeam: (id: number, revoke = false) => req<{ share_token: string | null }>('POST', `/api/teams/${id}/share`, { revoke }),
  sharedTeam: (token: string) => req<{ team: Pick<Team, 'id' | 'name'>; players: Player[]; matches: Match[]; events: VEvent[] }>('GET', `/api/share/team/${token}`),

  addEvent: (matchId: number, e: Partial<VEvent>) => req<VEvent>('POST', `/api/matches/${matchId}/events`, e),
  updateEvent: (id: number, e: Partial<VEvent>) => req<VEvent>('PATCH', `/api/events/${id}`, e),
  deleteEvent: (id: number) => req('DELETE', `/api/events/${id}`),
  bulkEvents: (matchId: number, op: 'confirm' | 'delete', ids: number[]) =>
    req('POST', `/api/matches/${matchId}/events/bulk`, { op, ids }),
};
