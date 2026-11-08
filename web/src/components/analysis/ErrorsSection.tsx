import { More } from './More';
import { BarChart, SERIES, StackedBars } from '../../charts/Charts';
import type { ActionCode } from '../../lib/actions';
import type { Player, VEvent } from '../../lib/api';
import { buildRallies, THEIR_POINTS, theirPoint, theirPointSpot, type TheirPoint } from '../../lib/sequence';
import { CourtFull } from '../CourtFull';
import type { PlotPoint } from '../CourtHalf';
import { scoreBySet } from '../../lib/stats';
import { ERROR_KINDS, errorKind } from '../../lib/trajectory';
import { who } from './AttackSection';
import { pct, ratio, StatFigure, Swatch } from './ui';

const KIND_COLOR: Record<TheirPoint, string> = { attack: SERIES.blue, block: SERIES.aqua, ace: SERIES.orange, unforced: '#d03b3b', unknown: '#9a9a96' };

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
  if (!errors.length) return <p className="muted small">No errors tagged.</p>;
  const rows = players
    .map((p) => {
      const mine = events.filter((e) => e.player_id === p.id);
      return { p, mine, errs: mine.filter(isError), pts: mine.filter((e) => POINTS.includes(e.action)).length };
    })
    .filter((r) => r.errs.length || r.pts)
    .sort((a, b) => b.errs.length - a.errs.length);
  const lost = buildRallies(events).filter((r) => r.won === false && r.end);
  const unforced = lost.filter((r) => theirPoint(r.end!) === 'unforced').length;
  const sets = scoreBySet(events);

  const attackKinds = ERROR_KINDS.map((k) => ({ ...k, n: events.filter((e) => (e.action === 'attack_error' || e.action === 'attack_blocked') && errorKind(e) === k.key).length }));
  const serveKinds = ERROR_KINDS.filter((k) => k.key !== 'blocked').map((k) => ({ ...k, n: events.filter((e) => e.action === 'serve_error' && errorKind(e) === k.key).length }));

  return (
    <div className="charts">
      <div className="kpis">
        <div className="kpi"><span className="kpi-label">Their points</span><span className="kpi-value">{lost.length}</span>
          <span className="kpi-sub">rallies we lost</span></div>
        <div className="kpi"><span className="kpi-label">Earned by them</span><span className="kpi-value">{lost.length - unforced}</span>
          <span className="kpi-sub">their attack, block or ace</span></div>
        <div className="kpi"><span className="kpi-label">Given away</span><span className="kpi-value">{unforced}</span>
          <span className="kpi-sub">{pct(ratio(unforced, lost.length))} · our serve, attack and set errors</span></div>
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

      <BarChart title="How our attacks fail" subtitle="Attack errors and blocks by where the ball went (from the second tap)"
        rows={attackKinds.filter((k) => k.n).map((k) => ({ label: k.label, value: k.n }))} valueTitle="Attacks" fmt={(v) => String(Math.round(v))} color="#d03b3b" />
      <BarChart title="How our serves fail" subtitle="Serve errors by where the ball went"
        rows={serveKinds.filter((k) => k.n).map((k) => ({ label: k.label, value: k.n }))} valueTitle="Serves" fmt={(v) => String(Math.round(v))} color="#d03b3b" />

      <More id="errors">
      {rows.filter((r) => r.errs.length >= 2).length > 0 && (
        <StackedBars title="Error mix per player" subtitle="Share of each player's errors by kind"
          keys={ERROR_TYPES.map((t) => ({ name: t.label, color: t.color }))}
          rows={rows.filter((r) => r.errs.length >= 2).map((r) => ({ label: who(r.p), parts: ERROR_TYPES.map((t) => r.errs.filter(t.test).length) }))}
          axisTitle="Share of errors" />
      )}

      {(() => {
        const kinds = THEIR_POINTS.filter((k) => k.key !== 'unknown' || lost.some((r) => theirPoint(r.end!) === 'unknown'));
        const unforcedAt = kinds.findIndex((k) => k.key === 'unforced');
        const bySet = [...new Set(lost.map((r) => r.set))].sort((a, b) => a - b).map((set) => {
          const ls = lost.filter((r) => r.set === set);
          const sc = sets.find((x) => x.set === set);
          return { set, us: sc?.us ?? 0, them: sc?.them ?? ls.length, n: ls.length, parts: kinds.map((k) => ls.filter((r) => theirPoint(r.end!) === k.key).length) };
        });
        return (
          <>
            <StackedBars title="How the opponent scored, per set" subtitle="Each of their points by what ended the rally: their attack (incl. digs and blocks of ours that could not keep it in play), their block, their ace, or our own unforced error (serve, attack out / net, set). Not specified = 'They won' without saying how"
              keys={kinds.map((k) => ({ name: k.label, color: KIND_COLOR[k.key] }))}
              rows={bySet.map((r) => ({ label: `Set ${r.set}`, parts: r.parts }))} axisTitle="Share of their points" />
            <StatFigure title="Their points per set" subtitle="Counts behind the chart above"
              rows={bySet} rowKey={(r) => r.set}
              first={{ h: 'Set', cell: (r) => `Set ${r.set}` }}
              columns={[
                { h: 'Score', cell: (r) => `${r.us}–${r.them}` },
                ...kinds.map((k, i) => ({ h: k.label.replace('Our unforced error', 'Our errors'), cell: (r: (typeof bySet)[number]) => r.parts[i] })),
                { h: 'Given', title: 'Share of their points that were our unforced errors', cell: (r) => {
                  const v = ratio(r.parts[unforcedAt], r.n);
                  return { text: pct(v), tone: v == null ? null : v >= 0.4 ? 'bad' : v <= 0.25 ? 'good' : null };
                } },
              ]} />
            {(() => {
              const dots: PlotPoint[] = lost.map((r) => ({ r, at: theirPointSpot(r.end!), k: theirPoint(r.end!) }))
                .filter((d) => d.at && (d.k === 'attack' || d.k === 'ace'))
                .map((d) => ({ key: d.r.end!.id, x: d.at!.x, y: d.at!.y, color: KIND_COLOR[d.k], title: `${d.k === 'ace' ? 'Their ace' : 'Their attack'}, set ${d.r.set}` }));
              return dots.length ? (
                <figure className="chart paper">
                  <figcaption>
                    <div className="chart-title"><b>Where their points landed</b></div>
                    <span className="chart-sub">Their attacks and aces on our side: where the ball came down, or where our dig or pass missed it (tagged with "They won")</span>
                    <span className="chart-legend"><Swatch fill={KIND_COLOR.attack} label="Their attack" /><Swatch fill={KIND_COLOR.ace} label="Their ace" /></span>
                  </figcaption>
                  <div className="plot-wrap paper"><CourtFull points={dots} yRange={[-2, 10]} /></div>
                </figure>
              ) : null;
            })()}
          </>
        );
      })()}
      </More>
    </div>
  );
}
