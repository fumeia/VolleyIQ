import type { Match, Player, Team, VEvent } from './api';

/**
 * A team export for training the auto-detection, without anything that names people or
 * teams: players are only their shirt number and role; matches lose their label,
 * opponent, date, video file name and match sheet; tags keep only what training needs
 * (time, action, grade, spots, rally, set, shirt number).
 */
export function anonymousExport(data: { team: Team; players: Player[]; matches: Match[]; events: VEvent[] }) {
  const matches = [...data.matches].sort((a, b) => (a.played_on ?? '').localeCompare(b.played_on ?? '') || a.id - b.id);
  return {
    kind: 'volleyiq-training-export',
    note: 'Shirt numbers and roles only: no names, teams, opponents or dates.',
    players: data.players.map((p) => ({ id: p.id, number: p.number, role: p.role })),
    matches: matches.map((m, k) => ({
      id: m.id,
      label: `Match ${k + 1}`,
      // Which half we play on, per set (the court marking), and the starting six by player id.
      calibration: m.calibration ?? null,
      lineups: m.lineups ?? null,
    })),
    events: data.events.map((e) => ({
      id: e.id, match_id: e.match_id, player_id: e.player_id, jersey: e.player_id != null ? data.players.find((p) => p.id === e.player_id)?.number ?? e.jersey : e.jersey,
      action: e.action, value: e.value, zone: e.zone, x: e.x, y: e.y, fx: e.fx ?? null, fy: e.fy ?? null,
      rally: e.rally ?? null, poss: e.poss ?? null, t: e.t, set_no: e.set_no, source: e.source, status: e.status,
    })),
  };
}
