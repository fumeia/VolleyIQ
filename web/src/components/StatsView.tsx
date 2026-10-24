import { useMemo, useState } from 'react';
import { ROLES, type ActionCode } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import { dec, pct, playerStats, roleStats, statLine, zoneCounts, type StatLine } from '../lib/stats';
import { ZoneCourt } from './ZoneCourt';

const HEAT_MODES: { id: string; label: string; actions: ActionCode[] }[] = [
  { id: 'kills', label: 'Kills', actions: ['kill'] },
  { id: 'attacks', label: 'All attacks', actions: ['kill', 'attack', 'attack_error'] },
  { id: 'atterr', label: 'Attack errors', actions: ['attack_error'] },
  { id: 'serves', label: 'Serves', actions: ['serve', 'ace'] },
  { id: 'aces', label: 'Aces', actions: ['ace'] },
];

type Tab = 'overview' | 'attack' | 'serve' | 'pass' | 'block' | 'roles';

const COLUMNS: Record<Exclude<Tab, 'roles'>, { h: string; v: (s: StatLine) => string | number }[]> = {
  overview: [
    { h: 'Pts', v: (s) => s.points }, { h: 'K', v: (s) => s.kills }, { h: 'A', v: (s) => s.aces },
    { h: 'BS', v: (s) => s.blockPoints }, { h: 'Err', v: (s) => s.errors }, { h: '+/−', v: (s) => s.plusMinus },
  ],
  attack: [
    { h: 'K', v: (s) => s.kills }, { h: 'E', v: (s) => s.attackErrors }, { h: 'TA', v: (s) => s.attempts },
    { h: 'K%', v: (s) => pct(s.killPct) }, { h: 'Eff', v: (s) => dec(s.attackEff, 3) },
  ],
  serve: [
    { h: 'SA', v: (s) => s.serves }, { h: 'Ace', v: (s) => s.aces }, { h: 'SE', v: (s) => s.serveErrors },
    { h: 'Ace%', v: (s) => pct(s.acePct) }, { h: 'In%', v: (s) => pct(s.serveInPct) },
  ],
  pass: [
    { h: 'Rec', v: (s) => s.receptions }, { h: 'Avg', v: (s) => dec(s.recAvg) }, { h: '3%', v: (s) => pct(s.recPerfectPct) },
    { h: 'RE', v: (s) => s.recErrors }, { h: 'Dig', v: (s) => s.digs }, { h: 'DE', v: (s) => s.digErrors },
  ],
  block: [
    { h: 'BS', v: (s) => s.blockPoints }, { h: 'BT', v: (s) => s.blockTouches }, { h: 'BE', v: (s) => s.blockErrors },
    { h: 'Sets', v: (s) => s.sets }, { h: 'Ast', v: (s) => s.assists }, { h: 'AE', v: (s) => s.assistErrors },
  ],
};

const roleName = (code: string) => ROLES.find((r) => r.code === code)?.label ?? code;

export function StatsView({ players, events }: { players: Player[]; events: VEvent[] }) {
  const confirmed = useMemo(() => events.filter((e) => e.status === 'confirmed'), [events]);
  const [tab, setTab] = useState<Tab>('overview');
  const [heat, setHeat] = useState(HEAT_MODES[0].id);
  const [heatPlayer, setHeatPlayer] = useState<number | 'all'>('all');

  const rows = useMemo(() => playerStats(players, confirmed).filter((r) => r.count > 0), [players, confirmed]);
  const roles = useMemo(() => roleStats(players, confirmed), [players, confirmed]);
  const team = useMemo(() => statLine(confirmed.filter((e) => e.player_id != null)), [confirmed]);
  const heatEvents = heatPlayer === 'all' ? confirmed : confirmed.filter((e) => e.player_id === heatPlayer);
  const counts = zoneCounts(heatEvents, HEAT_MODES.find((m) => m.id === heat)!.actions);

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

      <h3 className="section-title">Heatmap</h3>
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
