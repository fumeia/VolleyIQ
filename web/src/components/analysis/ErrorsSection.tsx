import { BarChart, StackedBars } from '../../charts/Charts';
import type { ActionCode } from '../../lib/actions';
import type { Player, VEvent } from '../../lib/api';
import { scoreBySet } from '../../lib/stats';
import { ERROR_KINDS, errorKind } from '../../lib/trajectory';
import { who } from './AttackSection';
import { pct, ratio, StatFigure } from './ui';

/** The ways we give points away, in a fixed order (categorical slots 1..7). */
export const ERROR_TYPES: { key: string; label: string; short: string; color: string; test: (e: VEvent) => boolean }[] = [
  { key: 'attack', short: 'Att', label: 'Attack out/net', color: '#2a78d6', test: (e) => e.action === 'attack_error' },
  { key: 'blocked', short: 'Blkd', label: 'Got blocked', color: '#eb6834', test: (e) => e.action === 'attack_blocked' },
  { key: 'serve', short: 'Srv', label: 'Serve error', color: '#1baf7a', test: (e) => e.action === 'serve_error' },
  { key: 'pass', short: 'Pass 0', label: 'Reception 0', color: '#eda100', test: (e) => e.action === 'receive' && e.value === 0 },
  { key: 'set', short: 'Set', label: 'Set error', color: '#e87ba4', test: (e) => e.action === 'set_error' || e.action === 'assist_error' },
  { key: 'dig', short: 'Dig', label: 'Dig error', color: '#008300', test: (e) => e.action === 'dig_error' },
  { key: 'block', short: 'Blk', label: 'Block error', color: '#6250d6', test: (e) => e.action === 'block_error' },
];
const POINTS: ActionCode[] = ['kill', 'ace', 'block_point'];

/** Errors: who gives points away, how, and when. */
export function ErrorsSection({ players, events }: { players: Player[]; events: VEvent[] }) {
  const isError = (e: VEvent) => ERROR_TYPES.some((t) => t.test(e));
  const errors = events.filter(isError);
  if (!errors.length) return <p className="muted small">No errors tagged — nice.</p>;
  const rows = players
    .map((p) => {
      const mine = events.filter((e) => e.player_id === p.id);
      return { p, mine, errs: mine.filter(isError), pts: mine.filter((e) => POINTS.includes(e.action)).length };
    })
    .filter((r) => r.errs.length || r.pts)
    .sort((a, b) => b.errs.length - a.errs.length);
  const total = errors.length;
  const oppPoints = events.filter((e) => e.action === 'opp_point').length;
  const sets = scoreBySet(events);

  const attackKinds = ERROR_KINDS.map((k) => ({ ...k, n: events.filter((e) => (e.action === 'attack_error' || e.action === 'attack_blocked') && errorKind(e) === k.key).length }));
  const serveKinds = ERROR_KINDS.filter((k) => k.key !== 'blocked').map((k) => ({ ...k, n: events.filter((e) => e.action === 'serve_error' && errorKind(e) === k.key).length }));

  return (
    <div className="charts">
      <div className="kpis">
        <div className="kpi"><span className="kpi-label">Points given away</span><span className="kpi-value">{total}</span>
          <span className="kpi-sub">{pct(ratio(total, total + oppPoints))} of the opponent's points</span></div>
        <div className="kpi"><span className="kpi-label">Opponent winners</span><span className="kpi-value">{oppPoints}</span>
          <span className="kpi-sub">points they earned themselves</span></div>
      </div>

      <StatFigure title="Points given away per player" subtitle="Own errors by kind, next to the points the player won; red when errors outnumber points"
        rows={rows} rowKey={(r) => r.p.id}
        first={{ h: 'Player', cell: (r) => who(r.p) }}
        columns={[
          ...ERROR_TYPES.map((t) => ({ h: t.short, title: t.label, cell: (r: (typeof rows)[number]) => r.errs.filter(t.test).length || '·' })),
          { h: 'Errors', cell: (r) => ({ text: r.errs.length, tone: r.errs.length > r.pts ? 'bad' : null }) },
          { h: 'Points', cell: (r) => ({ text: r.pts, tone: r.pts > r.errs.length ? 'good' : null }) },
          { h: '+/−', cell: (r) => { const v = r.pts - r.errs.length; return { text: v > 0 ? `+${v}` : String(v), tone: v > 0 ? 'good' : v < 0 ? 'bad' : null }; } },
        ]}
        play={(r) => r.errs} playLabel="Errors" />

      {rows.filter((r) => r.errs.length >= 2).length > 0 && (
        <StackedBars title="Error mix per player" subtitle="Share of each player's errors by kind"
          keys={ERROR_TYPES.map((t) => ({ name: t.label, color: t.color }))}
          rows={rows.filter((r) => r.errs.length >= 2).map((r) => ({ label: who(r.p), parts: ERROR_TYPES.map((t) => r.errs.filter(t.test).length) }))}
          axisTitle="Share of errors" />
      )}

      <BarChart title="How our attacks fail" subtitle="Attack errors and blocks by where the ball went (from the second tap)"
        rows={attackKinds.filter((k) => k.n).map((k) => ({ label: k.label, value: k.n }))} valueTitle="Attacks" fmt={(v) => String(Math.round(v))} color="#d03b3b" />
      <BarChart title="How our serves fail" subtitle="Serve errors by where the ball went"
        rows={serveKinds.filter((k) => k.n).map((k) => ({ label: k.label, value: k.n }))} valueTitle="Serves" fmt={(v) => String(Math.round(v))} color="#d03b3b" />

      <StatFigure title="Errors per set" subtitle="How many of the opponent's points we gave them ourselves"
        rows={sets} rowKey={(r) => r.set}
        first={{ h: 'Set', cell: (r) => `Set ${r.set}` }}
        columns={[
          { h: 'Score', cell: (r) => `${r.us}–${r.them}` },
          { h: 'Our errors', cell: (r) => events.filter((e) => (e.set_no ?? 1) === r.set && isError(e)).length },
          { h: 'Share', cell: (r) => {
            const n = events.filter((e) => (e.set_no ?? 1) === r.set && isError(e)).length;
            const v = ratio(n, r.them);
            return { text: pct(v), tone: v == null ? null : v >= 0.5 ? 'bad' : v <= 0.3 ? 'good' : null };
          } },
        ]} />
    </div>
  );
}
