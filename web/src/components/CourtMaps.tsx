import { useMemo, useState } from 'react';
import type { ActionCode } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import { playerStats, zoneCounts } from '../lib/stats';
import { RAMP, SERIES } from '../charts/Charts';
import type { PlotPoint } from './CourtHalf';
import { CourtFull, type PlotPath } from './CourtFull';
import { ZoneCourt } from './ZoneCourt';

const HEAT_MODES: { id: string; label: string; actions: ActionCode[] }[] = [
  { id: 'kills', label: 'Kills', actions: ['kill'] },
  { id: 'attacks', label: 'All attacks', actions: ['kill', 'attack', 'attack_error'] },
  { id: 'atterr', label: 'Attack errors', actions: ['attack_error'] },
  { id: 'serves', label: 'Serves', actions: ['serve', 'ace'] },
  { id: 'aces', label: 'Aces', actions: ['ace'] },
  { id: 'receives', label: 'Passes', actions: ['receive'] },
  { id: 'digs', label: 'Digs', actions: ['dig', 'dig_error'] },
  { id: 'freeballs', label: 'Free balls', actions: ['freeball'] },
  { id: 'blocks', label: 'Our blocks', actions: ['block_point', 'block_touch', 'block_error'] },
  { id: 'blocked', label: 'Got blocked', actions: ['attack_blocked'] },
];

const PLOT_MODES: { id: string; label: string; actions: ActionCode[] }[] = [
  { id: 'attacks', label: 'Attacks', actions: ['kill', 'attack', 'attack_error', 'attack_blocked'] },
  { id: 'serves', label: 'Serves', actions: ['ace', 'serve', 'serve_error'] },
  { id: 'receives', label: 'Receives', actions: ['receive'] },
  { id: 'sets', label: 'Sets', actions: ['set', 'assist', 'assist_error', 'set_error'] },
  { id: 'freeballs', label: 'Free balls', actions: ['freeball'] },
  { id: 'digs', label: 'Digs', actions: ['dig', 'dig_error'] },
  { id: 'blocks', label: 'Our blocks', actions: ['block_point', 'block_touch', 'block_error'] },
  { id: 'blocked', label: 'Got blocked', actions: ['attack_blocked'] },
];

// Outcome classes in the validated chart palette: point / kept in play / error.
const GOOD = SERIES.aqua, PLAY = SERIES.blue, BAD = SERIES.orange;
const OUTCOME_COLOR: Partial<Record<ActionCode, string>> = {
  kill: GOOD, ace: GOOD, attack: PLAY, serve: PLAY, attack_error: BAD, serve_error: BAD,
  set: PLAY, assist: PLAY, assist_error: BAD, set_error: BAD, freeball: PLAY,
  dig: PLAY, dig_error: BAD, block_point: GOOD, block_touch: PLAY, block_error: BAD, attack_blocked: BAD,
};
const GRADE_COLOR = RAMP;
const LEGEND: Record<string, [string, string][]> = {
  attacks: [[GOOD, 'Kill'], [PLAY, 'In play'], [BAD, 'Error']],
  serves: [[GOOD, 'Ace'], [PLAY, 'In play'], [BAD, 'Error']],
  receives: [[RAMP[3], '3'], [RAMP[2], '2'], [RAMP[1], '1'], [RAMP[0], '0']],
  digs: [[PLAY, 'Dig'], [BAD, 'Error']],
  blocks: [[GOOD, 'Block point'], [PLAY, 'Touch'], [BAD, 'Error']],
  blocked: [[BAD, 'Blocked']],
  sets: [[PLAY, 'Set / bump set'], [BAD, 'Error']],
  freeballs: [[PLAY, 'Free ball']],
};

const playerName = (players: Player[], id: number | null) => {
  const p = players.find((x) => x.id === id);
  return p ? `#${p.number} ${p.name}` : 'Unknown';
};

/**
 * Court maps: touches counted per zone, and each touch as a dot (where it went or was
 * played from) or an arrow. Any player or all; [only] fixes it to one player (player pages).
 */
export function CourtMaps({ players, events, only }: { players: Player[]; events: VEvent[]; only?: number }) {
  const [heat, setHeat] = useState(HEAT_MODES[0].id);
  const [heatPlayer, setHeatPlayer] = useState<number | 'all'>(only ?? 'all');
  const [plot, setPlot] = useState(PLOT_MODES[0].id);
  const [density, setDensity] = useState(false);
  const [plotView, setPlotView] = useState<'to' | 'from' | 'path'>('to');
  const confirmed = events;
  const rows = useMemo(() => playerStats(players, confirmed).filter((r) => r.count > 0), [players, confirmed]);
  const heatEvents = heatPlayer === 'all' ? confirmed : confirmed.filter((e) => e.player_id === heatPlayer);
  const counts = zoneCounts(heatEvents, HEAT_MODES.find((m) => m.id === heat)!.actions);
  const plotMode = PLOT_MODES.find((m) => m.id === plot)!;
  const colorOf = (e: VEvent) => (e.action === 'receive' ? GRADE_COLOR[e.value ?? 1] : OUTCOME_COLOR[e.action] ?? '#9ca3af');
  const titleOf = (e: VEvent) => `${playerName(players, e.player_id)} ${e.action.replace('_', ' ')}${e.value != null ? ' ' + e.value : ''}`;
  const modeEvents = heatEvents.filter((e) => plotMode.actions.includes(e.action));
  // "Went to" = x, y; "played from" = fx, fy.
  const plotPoints: PlotPoint[] = modeEvents
    .map((e) => (plotView === 'from' ? { e, x: e.fx, y: e.fy } : { e, x: e.x, y: e.y }))
    .filter((p) => p.x != null && p.y != null)
    .map(({ e, x, y }) => ({ key: e.id, x: x!, y: y!, color: colorOf(e), title: titleOf(e) }));
  const plotPaths: PlotPath[] = modeEvents
    .filter((e) => e.x != null && e.y != null && e.fx != null && e.fy != null)
    .map((e) => ({ key: e.id, from: { x: e.fx!, y: e.fy! }, to: { x: e.x!, y: e.y! }, color: colorOf(e), title: titleOf(e) }));

  return (
    <>
      <h3 className="section-title">By zone</h3>
      <div className="chips">
        {HEAT_MODES.map((m) => (
          <button key={m.id} className={`chip ${heat === m.id ? 'on' : ''}`} onClick={() => setHeat(m.id)}>{m.label}</button>
        ))}
      </div>
      {only == null && <select className="input" value={heatPlayer} onChange={(e) => setHeatPlayer(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
        <option value="all">All players</option>
        {rows.map((r) => <option key={r.player.id} value={r.player.id}>#{r.player.number} {r.player.name}</option>)}
      </select>}
      <ZoneCourt counts={counts} />

      <h3 className="section-title">Court plot</h3>
      <div className="chips">
        {PLOT_MODES.map((m) => (
          <button key={m.id} className={`chip ${plot === m.id ? 'on' : ''}`} onClick={() => setPlot(m.id)}>{m.label}</button>
        ))}
      </div>
      <div className="segmented">
        <button className={plotView === 'to' ? 'on' : ''} onClick={() => setPlotView('to')}>Went to</button>
        <button className={plotView === 'from' ? 'on' : ''} onClick={() => setPlotView('from')}>Played from</button>
        <button className={plotView === 'path' ? 'on' : ''} onClick={() => setPlotView('path')}>Paths</button>
      </div>
      {plotView !== 'path' && (
        <label className="toggle small"><input type="checkbox" checked={density} onChange={(e) => setDensity(e.target.checked)} /> Heatmap (count per 1.5 m square)</label>
      )}
      <div className="plot-wrap paper">
        {plotView === 'path'
          ? <CourtFull paths={plotPaths} zoneCounts showTarget={plotMode.id === 'receives'} />
          : <CourtFull points={plotPoints} heat={density} showTarget={plotMode.id === 'receives'} />}
      </div>
      <div className="legend">
        {(plotView === 'path' || !density) && LEGEND[plot].map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}
        {plotView !== 'path' && density && <span>Darker = more touches in that 1.5 m square</span>}
        {plotView === 'path' && <span>Numbers: paths ending in each zone</span>}
        <span className="muted">{plotView === 'path' ? plotPaths.length : plotPoints.length} with {plotView === 'path' ? 'both spots' : 'this spot'}{heatPlayer === 'all' || only != null ? '' : ' (filtered)'}</span>
      </div>
    </>
  );
}
