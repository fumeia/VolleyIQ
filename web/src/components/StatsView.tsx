import { useMemo, useState } from 'react';
import { ROLES, type ActionCode } from '../lib/actions';
import type { Match, Player, VEvent } from '../lib/api';
import { AnalysisCharts } from './AnalysisCharts';
import { dec, pct, playerStats, roleStats, statLine, zoneCounts, type StatLine } from '../lib/stats';
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

const OUTCOME_COLOR: Partial<Record<ActionCode, string>> = {
  kill: '#22c55e', ace: '#22c55e', attack: '#60a5fa', serve: '#60a5fa', attack_error: '#ef4444', serve_error: '#ef4444',
  set: '#60a5fa', assist: '#22c55e', assist_error: '#ef4444', set_error: '#ef4444', freeball: '#60a5fa',
  dig: '#60a5fa', dig_error: '#ef4444', block_point: '#22c55e', block_touch: '#60a5fa', block_error: '#ef4444', attack_blocked: '#ef4444',
};
const GRADE_COLOR = ['#ef4444', '#f59e0b', '#60a5fa', '#22c55e'];
const LEGEND: Record<string, [string, string][]> = {
  attacks: [['#22c55e', 'Kill'], ['#60a5fa', 'In play'], ['#ef4444', 'Error']],
  serves: [['#22c55e', 'Ace'], ['#60a5fa', 'In play'], ['#ef4444', 'Error']],
  receives: [['#22c55e', '3'], ['#60a5fa', '2'], ['#f59e0b', '1'], ['#ef4444', '0']],
  digs: [['#60a5fa', 'Dig'], ['#ef4444', 'Error']],
  blocks: [['#22c55e', 'Block point'], ['#60a5fa', 'Touch'], ['#ef4444', 'Error']],
  blocked: [['#ef4444', 'Blocked']],
  sets: [['#22c55e', 'Assist'], ['#60a5fa', 'Set'], ['#ef4444', 'Error']],
  freeballs: [['#60a5fa', 'Free ball']],
};

type Tab = 'overview' | 'attack' | 'serve' | 'pass' | 'block' | 'roles';

const COLUMNS: Record<Exclude<Tab, 'roles'>, { h: string; v: (s: StatLine) => string | number }[]> = {
  overview: [
    { h: 'Pts', v: (s) => s.points }, { h: 'K', v: (s) => s.kills }, { h: 'A', v: (s) => s.aces },
    { h: 'BS', v: (s) => s.blockPoints }, { h: 'Err', v: (s) => s.errors }, { h: '+/−', v: (s) => s.plusMinus },
  ],
  attack: [
    { h: 'K', v: (s) => s.kills }, { h: 'E', v: (s) => s.attackErrors }, { h: 'BA', v: (s) => s.blocked }, { h: 'TA', v: (s) => s.attempts },
    { h: 'K%', v: (s) => pct(s.killPct) }, { h: 'Eff', v: (s) => dec(s.attackEff, 3) },
  ],
  serve: [
    { h: 'SA', v: (s) => s.serves }, { h: 'Ace', v: (s) => s.aces }, { h: 'SE', v: (s) => s.serveErrors },
    { h: 'Ace%', v: (s) => pct(s.acePct) }, { h: 'In%', v: (s) => pct(s.serveInPct) },
  ],
  pass: [
    { h: 'Rec', v: (s) => s.receptions }, { h: 'Avg', v: (s) => dec(s.recAvg) }, { h: '3%', v: (s) => pct(s.recPerfectPct) },
    { h: 'RE', v: (s) => s.recErrors }, { h: 'Dig', v: (s) => s.digs }, { h: 'DE', v: (s) => s.digErrors }, { h: 'FB', v: (s) => s.freeballs },
  ],
  block: [
    { h: 'BS', v: (s) => s.blockPoints }, { h: 'BT', v: (s) => s.blockTouches }, { h: 'BE', v: (s) => s.blockErrors },
    { h: 'Sets', v: (s) => s.sets }, { h: 'Ast', v: (s) => s.assists }, { h: 'AE', v: (s) => s.assistErrors }, { h: 'SE', v: (s) => s.setErrors },
  ],
};

const playerName = (players: Player[], id: number | null) => {
  const p = players.find((x) => x.id === id);
  return p ? `#${p.number} ${p.name}` : 'Unknown';
};

const roleName = (code: string) => ROLES.find((r) => r.code === code)?.label ?? code;

export function StatsView({ players, events, matches }: { players: Player[]; events: VEvent[]; matches?: Match[] }) {
  const confirmed = useMemo(() => events.filter((e) => e.status === 'confirmed'), [events]);
  const [section, setSection] = useState<'charts' | 'tables' | 'court'>(() => (localStorage.getItem('viq:statsSection') as 'charts') ?? 'charts');
  const pickSection = (s: 'charts' | 'tables' | 'court') => { setSection(s); try { localStorage.setItem('viq:statsSection', s); } catch { /* private mode */ } };
  const [tab, setTab] = useState<Tab>('overview');
  const [heat, setHeat] = useState(HEAT_MODES[0].id);
  const [heatPlayer, setHeatPlayer] = useState<number | 'all'>('all');
  const [plot, setPlot] = useState(PLOT_MODES[0].id);
  const [density, setDensity] = useState(false);
  const [plotView, setPlotView] = useState<'to' | 'from' | 'path'>('to');

  const rows = useMemo(() => playerStats(players, confirmed).filter((r) => r.count > 0), [players, confirmed]);
  const roles = useMemo(() => roleStats(players, confirmed), [players, confirmed]);
  const team = useMemo(() => statLine(confirmed.filter((e) => e.player_id != null)), [confirmed]);
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

  if (!confirmed.length) return <p className="muted small">No confirmed tags yet. Start tagging to see stats.</p>;

  const cols = COLUMNS[tab === 'roles' ? 'overview' : tab];
  return (
    <div className="stats">
      <div className="kpis">
        <Kpi label="Attack eff." value={dec(team.attackEff, 3)} sub={`${team.kills}K / ${team.attackErrors}E / ${team.attempts}TA`} />
        <Kpi label="Kill %" value={pct(team.killPct)} />
        <Kpi label="Serve in" value={pct(team.serveInPct)} sub={`${team.aces} aces`} />
        <Kpi label="Pass avg" value={dec(team.recAvg)} sub={`${team.receptions} rec`} />
        <Kpi label="Blocks" value={String(team.blockPoints)} sub={`${team.blockTouches} touches`} />
        <Kpi label="Errors" value={String(team.errors)} />
      </div>

      <div className="segmented">
        <button className={section === 'charts' ? 'on' : ''} onClick={() => pickSection('charts')}>Charts</button>
        <button className={section === 'tables' ? 'on' : ''} onClick={() => pickSection('tables')}>Player tables</button>
        <button className={section === 'court' ? 'on' : ''} onClick={() => pickSection('court')}>Court maps</button>
      </div>

      {section === 'charts' && <AnalysisCharts players={players} events={events} matches={matches} />}

      {section === 'tables' && <>
      <div className="tabs">
        {(['overview', 'attack', 'serve', 'pass', 'block', 'roles'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t === 'pass' ? 'Pass/Dig' : t === 'block' ? 'Block/Set' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="stat-table">
          <thead>
            <tr>
              <th>{tab === 'roles' ? 'Role' : 'Player'}</th>
              {(tab === 'roles' ? ROLE_COLS : cols).map((c) => <th key={c.h}>{c.h}</th>)}
            </tr>
          </thead>
          <tbody>
            {tab === 'roles'
              ? roles.map((r) => (
                <tr key={r.role}>
                  <td>{roleName(r.role)}</td>
                  {ROLE_COLS.map((c) => <td key={c.h}>{c.v(r.stats)}</td>)}
                </tr>
              ))
              : rows.map((r) => (
                <tr key={r.player.id}>
                  <td><span className={`num-dot role-${r.player.role}`}>{r.player.number ?? '–'}</span> {r.player.name}</td>
                  {cols.map((c) => <td key={c.h}>{c.v(r.stats)}</td>)}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      </>}

      {section === 'court' && <>
      <h3 className="section-title">By zone</h3>
      <div className="chips">
        {HEAT_MODES.map((m) => (
          <button key={m.id} className={`chip ${heat === m.id ? 'on' : ''}`} onClick={() => setHeat(m.id)}>{m.label}</button>
        ))}
      </div>
      <select className="input" value={heatPlayer} onChange={(e) => setHeatPlayer(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
        <option value="all">All players</option>
        {rows.map((r) => <option key={r.player.id} value={r.player.id}>#{r.player.number} {r.player.name}</option>)}
      </select>
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
      <div className="plot-wrap">
        {plotView === 'path'
          ? <CourtFull paths={plotPaths} showTarget={plotMode.id === 'receives'} />
          : <CourtFull points={plotPoints} heat={density} showTarget={plotMode.id === 'receives'} />}
      </div>
      <div className="legend">
        {(plotView === 'path' || !density) && LEGEND[plot].map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}
        {plotView !== 'path' && density && <span>Darker = more touches in that 1.5 m square</span>}
        <span className="muted">{plotView === 'path' ? plotPaths.length : plotPoints.length} with {plotView === 'path' ? 'both spots' : 'this spot'}{heatPlayer === 'all' ? '' : ' (filtered)'}</span>
      </div>
      </>}
    </div>
  );
}

const ROLE_COLS: { h: string; v: (s: StatLine) => string | number }[] = [
  { h: 'Pts', v: (s) => s.points }, { h: 'Eff', v: (s) => dec(s.attackEff, 3) }, { h: 'Ace', v: (s) => s.aces },
  { h: 'Pass', v: (s) => dec(s.recAvg) }, { h: 'Dig', v: (s) => s.digs }, { h: 'BS', v: (s) => s.blockPoints }, { h: 'Err', v: (s) => s.errors },
];

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}
