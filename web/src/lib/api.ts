import type { ActionCode, RoleCode } from './actions';

export interface Team { id: number; name: string; coach: string | null; player_count?: number }
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
export interface Job { id: number; match_id: number; status: 'queued' | 'running' | 'done' | 'failed'; progress: number; message: string | null }
export interface MatchBundle { match: Match; players: Player[]; events: VEvent[]; jobs?: Job[] }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !url.startsWith('/api/login')) window.dispatchEvent(new Event('viq:unauthorized'));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? res.statusText);
  }
  return res.json();
}

export const api = {
  me: () => req<{ authenticated: boolean; passwordRequired: boolean }>('GET', '/api/me'),
  login: (password: string) => req('POST', '/api/login', { password }),
  logout: () => req('POST', '/api/logout', {}),

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

  addEvent: (matchId: number, e: Partial<VEvent>) => req<VEvent>('POST', `/api/matches/${matchId}/events`, e),
  updateEvent: (id: number, e: Partial<VEvent>) => req<VEvent>('PATCH', `/api/events/${id}`, e),
  deleteEvent: (id: number) => req('DELETE', `/api/events/${id}`),
  bulkEvents: (matchId: number, op: 'confirm' | 'delete', ids: number[]) =>
    req('POST', `/api/matches/${matchId}/events/bulk`, { op, ids }),

  analyze: (matchId: number, opts: { jersey_ocr?: boolean; replace_suggestions?: boolean } = {}) =>
    req<Job>('POST', `/api/matches/${matchId}/analyze`, opts),
  job: (id: number) => req<Job>('GET', `/api/jobs/${id}`),

  uploadVideo(matchId: number, file: File, onProgress: (f: number) => void): Promise<Match> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', file);
      xhr.open('POST', `/api/matches/${matchId}/video`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(xhr.status, data.error ?? 'Upload failed'));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
      xhr.send(form);
    });
  },
};
