import { useMemo, useState } from 'react';
import { ROLES, type ActionCode } from '../lib/actions';
import type { Match, Player, VEvent } from '../lib/api';
import { AttackSection } from './analysis/AttackSection';
import { DefenseSection } from './analysis/DefenseSection';
import { ErrorsSection } from './analysis/ErrorsSection';
import { OverviewSection } from './analysis/OverviewSection';
import { PlayersSection } from './analysis/PlayersSection';
import { ServePassSection } from './analysis/ServePassSection';
import { SettingSection } from './analysis/SettingSection';
import { judge, PlayContext, Val, type Tone } from './analysis/ui';
import { dec, pct, playerStats, roleStats, zoneCounts, type StatLine } from '../lib/stats';
import type { PlotPoint } from './CourtHalf';
import { CourtFull, type PlotPath } from './CourtFull';
import { RAMP, SERIES } from '../charts/Charts';
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

type Tab = 'overview' | 'attack' | 'serve' | 'pass' | 'block' | 'roles';

type CellV = string | number | { text: string | number; tone: Tone };
const t = (text: string | number, tone: Tone) => ({ text, tone });
const COLUMNS: Record<Exclude<Tab, 'roles'>, { h: string; v: (s: StatLine) => CellV }[]> = {
  overview: [
    { h: 'Pts', v: (s) => s.points }, { h: 'K', v: (s) => s.kills }, { h: 'A', v: (s) => s.aces },
    { h: 'BS', v: (s) => s.blockPoints }, { h: 'Err', v: (s) => s.errors }, { h: '+/−', v: (s) => t(s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus, judge.plusMinus(s.plusMinus)) },
  ],
  attack: [
    { h: 'K', v: (s) => s.kills }, { h: 'E', v: (s) => s.attackErrors }, { h: 'BA', v: (s) => s.blocked }, { h: 'TA', v: (s) => s.attempts },
    { h: 'K%', v: (s) => t(pct(s.killPct), s.attempts >= 5 ? judge.killPct(s.killPct) : null) }, { h: 'Eff', v: (s) => t(dec(s.attackEff, 3), s.attempts >= 3 ? judge.eff(s.attackEff) : null) },
  ],
  serve: [
    { h: 'SA', v: (s) => s.serves }, { h: 'Ace', v: (s) => s.aces }, { h: 'SE', v: (s) => s.serveErrors },
    { h: 'Ace%', v: (s) => t(pct(s.acePct), s.serves >= 5 ? judge.acePct(s.acePct) : null) }, { h: 'Err%', v: (s) => { const v = s.serves ? s.serveErrors / s.serves : null; return t(pct(v), s.serves >= 5 ? judge.serveErrPct(v) : null); } },
  ],
  pass: [
    { h: 'Rec', v: (s) => s.receptions }, { h: 'Avg', v: (s) => t(dec(s.recAvg), s.receptions >= 5 ? judge.passAvg(s.recAvg) : null) }, { h: '3%', v: (s) => t(pct(s.recPerfectPct), s.receptions >= 5 ? judge.perfectPct(s.recPerfectPct) : null) },
    { h: 'RE', v: (s) => s.recErrors }, { h: 'Dig', v: (s) => s.digs }, { h: 'DE', v: (s) => s.digErrors }, { h: 'FB', v: (s) => s.freeballs },
  ],
  block: [
    { h: 'BS', v: (s) => s.blockPoints }, { h: 'BT', v: (s) => s.blockTouches }, { h: 'BE', v: (s) => s.blockErrors },
    { h: 'Sets', v: (s) => s.sets }, { h: 'Ast', v: (s) => s.assists }, { h: 'Bump', v: (s) => s.bumpSets }, { h: 'SE', v: (s) => s.setErrors + s.assistErrors },
  ],
};

const playerName = (players: Player[], id: number | null) => {
  const p = players.find((x) => x.id === id);
  return p ? `#${p.number} ${p.name}` : 'Unknown';
};

const roleName = (code: string) => ROLES.find((r) => r.code === code)?.label ?? code;

type Section = 'overview' | 'attack' | 'servepass' | 'setting' | 'defense' | 'errors' | 'players' | 'tables' | 'court';
const SECTIONS: [Section, string][] = [
  ['overview', 'Overview'], ['attack', 'Attack'], ['servepass', 'Serve & pass'], ['setting', 'Setting'], ['defense', 'Defence'],
  ['errors', 'Errors'], ['players', 'Players'], ['tables', 'Tables'], ['court', 'Court maps'],
];

export function StatsView({ players, events, matches, onPlay }: {
  players: Player[]; events: VEvent[]; matches?: Match[];
  /** Watch tags as clips on the match video (only on the match page, with a video loaded). */
  onPlay?: (list: VEvent[]) => void;
}) {
  const confirmed = useMemo(() => events.filter((e) => e.status === 'confirmed'), [events]);
  const [section, setSection] = useState<Section>(() => {
    try { const v = localStorage.getItem('viq:statsSection') as Section; return SECTIONS.some(([k]) => k === v) ? v : 'overview'; } catch { return 'overview'; }
  });
  const pickSection = (s: Section) => { setSection(s); try { localStorage.setItem('viq:statsSection', s); } catch { /* private mode */ } };
  const [tab, setTab] = useState<Tab>('overview');
  const [heat, setHeat] = useState(HEAT_MODES[0].id);
  const [heatPlayer, setHeatPlayer] = useState<number | 'all'>('all');
  const [plot, setPlot] = useState(PLOT_MODES[0].id);
  const [density, setDensity] = useState(false);
  const [plotView, setPlotView] = useState<'to' | 'from' | 'path'>('to');

  const rows = useMemo(() => playerStats(players, confirmed).filter((r) => r.count > 0), [players, confirmed]);
  const roles = useMemo(() => roleStats(players, confirmed), [players, confirmed]);
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
    <PlayContext.Provider value={onPlay ?? null}>
    <div className="stats">
      <div className="tabs stats-tabs">
        {SECTIONS.map(([k, label]) => <button key={k} className={`tab ${section === k ? 'on' : ''}`} onClick={() => pickSection(k)}>{label}</button>)}
      </div>

      {section === 'overview' && <OverviewSection players={players} events={confirmed} matches={matches} />}
      {section === 'attack' && <AttackSection players={players} events={confirmed} />}
      {section === 'servepass' && <ServePassSection players={players} events={confirmed} />}
      {section === 'setting' && <SettingSection players={players} events={confirmed} />}
      {section === 'defense' && <DefenseSection players={players} events={confirmed} />}
      {section === 'errors' && <ErrorsSection players={players} events={confirmed} />}
      {section === 'players' && <PlayersSection players={players} events={confirmed} />}

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
                  {ROLE_COLS.map((c) => <td key={c.h}>{cellOut(c.v(r.stats))}</td>)}
                </tr>
              ))
              : rows.map((r) => (
                <tr key={r.player.id}>
                  <td><span className={`num-dot role-${r.player.role}`}>{r.player.number ?? '–'}</span> {r.player.name}</td>
                  {cols.map((c) => <td key={c.h}>{cellOut(c.v(r.stats))}</td>)}
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
      <div className="plot-wrap paper">
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
    </PlayContext.Provider>
  );
}

const ROLE_COLS: { h: string; v: (s: StatLine) => CellV }[] = [
  { h: 'Pts', v: (s) => s.points }, { h: 'Eff', v: (s) => t(dec(s.attackEff, 3), s.attempts >= 3 ? judge.eff(s.attackEff) : null) }, { h: 'Ace', v: (s) => s.aces },
  { h: 'Pass', v: (s) => t(dec(s.recAvg), s.receptions >= 5 ? judge.passAvg(s.recAvg) : null) }, { h: 'Dig', v: (s) => s.digs }, { h: 'BS', v: (s) => s.blockPoints }, { h: 'Err', v: (s) => s.errors },
];

const cellOut = (c: CellV) => (typeof c === 'object' ? <Val tone={c.tone}>{c.text}</Val> : c);

