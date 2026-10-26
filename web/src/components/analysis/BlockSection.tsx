import type { Player, VEvent } from '../../lib/api';
import { SERIES } from '../../charts/Charts';
import { ourZone } from '../../lib/trajectory';
import { CourtFull, type PlotPath } from '../CourtFull';
import type { PlotPoint } from '../CourtHalf';
import { who } from './AttackSection';
import { HalfZones, pct, PlayBtn, sequential, StatFigure, Swatch, type ZoneValue } from './ui';

export const BLOCKS = ['block_point', 'block_touch', 'block_error', 'block_miss'];

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
            <span className="chart-sub">Their attacks that went past our block: from where they hit it to where it went ({list.length} blocks, {paths.length + dots.length} with a spot)</span>
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
      <NoTouchBlocks players={players} events={events} only={only} />
    </div>
  );
}
