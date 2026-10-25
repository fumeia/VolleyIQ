import { actionLabel } from './actions';
import type { Match, Player, VEvent } from './api';
import { playerStats } from './stats';

function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (m: Match) => m.label.replace(/[^\w-]+/g, '_');

export function exportEventsCsv(match: Match, players: Player[], events: VEvent[]) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const confirmed = events.filter((e) => e.status === 'confirmed');
  download(`${slug(match)}-events.csv`, toCsv([
    ['time_s', 'set', 'jersey', 'player', 'role', 'action', 'grade', 'zone', 'from_x_m', 'from_y_m', 'to_x_m', 'to_y_m', 'source'],
    ...confirmed.map((e) => {
      const p = e.player_id != null ? byId.get(e.player_id) : undefined;
      return [e.t?.toFixed(2), e.set_no, p?.number ?? e.jersey, p?.name, p?.role, actionLabel(e), e.value, e.zone, e.fx, e.fy, e.x, e.y, e.source];
    }),
  ]));
}

export function exportPlayersCsv(match: Match, players: Player[], events: VEvent[]) {
  const confirmed = events.filter((e) => e.status === 'confirmed');
  download(`${slug(match)}-players.csv`, toCsv([
    ['jersey', 'player', 'role', 'points', 'kills', 'attack_errors', 'attempts', 'attack_eff', 'aces', 'serve_errors',
      'serves', 'receptions', 'rec_avg', 'digs', 'block_points', 'block_touches', 'assists', 'errors'],
    ...playerStats(players, confirmed).filter((r) => r.count).map(({ player: p, stats: s }) => [
      p.number, p.name, p.role, s.points, s.kills, s.attackErrors, s.attempts, s.attackEff?.toFixed(3), s.aces, s.serveErrors,
      s.serves, s.receptions, s.recAvg?.toFixed(2), s.digs, s.blockPoints, s.blockTouches, s.assists, s.errors,
    ]),
  ]));
}
