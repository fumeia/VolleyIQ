import type { Player, VEvent } from '../../lib/api';
import { SERIES } from '../../charts/Charts';
import { ourZone } from '../../lib/trajectory';
import { CourtFull, type PlotPath } from '../CourtFull';
import type { PlotPoint } from '../CourtHalf';
import { who } from './AttackSection';
import { HalfZones, pct, PlayBtn, sequential, StatFigure, Swatch, type ZoneValue } from './ui';

export const BLOCKS = ['block_point', 'block_touch', 'block_error', 'block_miss'];

const KINDS: { action: string; label: string; color: string }[] = [
  { action: 'block_point', label: 'Point', color: SERIES.aqua },
  { action: 'block_touch', label: 'Touch', color: SERIES.blue },
  { action: 'block_miss', label: 'No touch', color: SERIES.orange },
  { action: 'block_error', label: 'Error', color: '#d03b3b' },
];
/** Where along the net a block was (meters from our left antenna), when it was placed there. */
export function netX(e: VEvent): number | null {
  const [x, y] = e.action === 'block_miss' ? [e.fx, e.fy] : [e.x, e.y];
  return x != null && y != null && Math.abs(y - 9) <= 1.5 ? Math.max(0, Math.min(8.999, x)) : null;
}

/**
 * Blocks along the net, metre by metre: points, touches, no touch and errors stacked,
 * so the gaps (lots of no touch, few touches) show where the block is open.
 */
export function NetBlocks({ players, events, only }: { players: Player[]; events: VEvent[]; only?: number }) {
  const list = events.filter((e) => BLOCKS.includes(e.action) && (only == null || e.player_id === only) && netX(e) != null);
  if (list.length < 3) return null;
  const forWho = only == null ? '' : ` · ${who(players.find((p) => p.id === only)!)}`;
  const bins = Array.from({ length: 9 }, (_, m) => KINDS.map((k) => list.filter((e) => e.action === k.action && Math.floor(netX(e)!) === m).length));
  const max = Math.max(1, ...bins.map((b) => b.reduce((a, n) => a + n, 0)));
  const H = 60, colW = 0.8;
  return (
    <figure className="chart">
      <figcaption>
        <div className="chart-title"><b>Blocks along the net{forWho}</b></div>
        <span className="chart-sub">Every block placed at the net, per metre from our left antenna (zone 4) to the right (zone 2), seen from behind our baseline. Many "no touch" and few touches = a hole in the block.</span>
        <span className="chart-legend">{KINDS.map((k) => <Swatch key={k.action} fill={k.color} label={k.label} />)}</span>
      </figcaption>
      <svg viewBox="-0.4 -0.8 9.8 8.6" className="net-chart" role="img" aria-label="Blocks per metre along the net">
        {bins.map((b, m) => {
          let y = 60 / 10;
          const total = b.reduce((a, n) => a + n, 0);
          return (
            <g key={m}>
              {b.map((n, k) => {
                if (!n) return null;
                const h = (n / max) * (H / 10);
                y -= h;
                return <rect key={k} x={m + (1 - colW) / 2} y={y} width={colW} height={h} fill={KINDS[k].color}><title>{`${m}–${m + 1} m: ${n} ${KINDS[k].label.toLowerCase()}`}</title></rect>;
              })}
              {total > 0 && <text x={m + 0.5} y={y - 0.25} className="net-chart-n">{total}</text>}
            </g>
          );
        })}
        <line x1={0} x2={9} y1={6.15} y2={6.15} className="net-line" />
        <line x1={0} x2={0} y1={5} y2={7} className="net-antenna" />
        <line x1={9} x2={9} y1={5} y2={7} className="net-antenna" />
        {[[1.5, 'Zone 4'], [4.5, 'Zone 3'], [7.5, 'Zone 2']].map(([x, l]) => <text key={l} x={x as number} y={7.3} className="net-chart-z">{l}</text>)}
      </svg>
    </figure>
  );
}

/**
 * Blocks without a touch: where their attack was hit from and where it went past our
 * block, so a blocker can see where they should have been. [only]: one player's.
 */
export function NoTouchBlocks({ players, events, only }: { players: Player[]; events: VEvent[]; only?: number }) {
  const list = events.filter((e) => e.action === 'block_miss' && (only == null || e.player_id === only));
  if (!list.length) return null;
  const forWho = only == null ? '' : ` · ${who(players.find((p) => p.id === only)!)}`;
  const paths: PlotPath[] = list.filter((e) => e.fx != null && e.fy != null && e.x != null && e.y != null)
    .map((e) => ({ key: e.id, from: { x: e.fx!, y: e.fy! }, to: { x: e.x!, y: e.y! }, color: SERIES.orange, title: `${who(players.find((p) => p.id === e.player_id) ?? ({ number: null, name: '?' } as Player))}: no touch` }));
  const dots: PlotPoint[] = list.filter((e) => e.x != null && e.y != null && e.fx == null)
    .map((e) => ({ key: e.id, x: e.x!, y: e.y!, color: SERIES.orange, title: 'Went past the block' }));
  const zones = new Map<number, ZoneValue>();
  const placed = list.filter((e) => ourZone(e) != null);
  const max = Math.max(1, ...[4, 3, 2, 5, 6, 1].map((z) => placed.filter((e) => ourZone(e) === z).length));
  for (const z of [4, 3, 2, 5, 6, 1]) {
    const n = placed.filter((e) => ourZone(e) === z).length;
    if (n) zones.set(z, { fill: sequential(n / max), main: String(n), sub: pct(n / placed.length), title: `Zone ${z}: ${n} attacks went past the block` });
  }
  return (
    <>
      {(paths.length > 0 || dots.length > 0) && (
        <figure className="chart paper">
          <figcaption>
            <div className="chart-title"><b>Blocks without a touch{forWho}</b></div>
            <span className="chart-sub">From where the block was at the net to where the ball went ({list.length} blocks, {paths.length + dots.length} with a spot)</span>
            <span className="chart-legend"><Swatch fill={SERIES.orange} label="Their attack past our block" /><PlayBtn list={list} label="Watch these" /></span>
          </figcaption>
          <div className="plot-wrap paper"><CourtFull paths={paths} points={dots} zoneCounts={paths.length > 0} /></div>
        </figure>
      )}
      {placed.length > 0 && (
        <HalfZones title={`Where the ball went past the block${forWho}`} subtitle="Their attacks past our block, counted by the zone of our court they went to"
          half="ours" values={zones} legend={<><Swatch fill={sequential(1)} label="Most" /><Swatch fill={sequential(0.15)} label="Few" /></>} />
      )}
    </>
  );
}

/** Blocking of one player (player pages): points, touches, errors, no-touch blocks, and where the ball went past. */
export function BlockSection({ players, events, only }: { players: Player[]; events: VEvent[]; only: number }) {
  const mine = events.filter((e) => e.player_id === only && BLOCKS.includes(e.action));
  const n = (a: string) => mine.filter((e) => e.action === a).length;
  return (
    <div className="charts">
      <StatFigure title="Blocking" subtitle="No touch = jumped to block, the ball went past without a touch"
        rows={[{ k: 'b' }]} rowKey={(r) => r.k}
        first={{ h: '', cell: () => who(players.find((p) => p.id === only)!) }}
        columns={[
          { h: 'Points', cell: () => ({ text: n('block_point'), tone: n('block_point') > 0 ? 'good' : null }) },
          { h: 'Touches', cell: () => n('block_touch') },
          { h: 'Errors', cell: () => n('block_error') },
          { h: 'No touch', cell: () => n('block_miss') },
        ]} />
      <NetBlocks players={players} events={events} only={only} />
      <NoTouchBlocks players={players} events={events} only={only} />
    </div>
  );
}
