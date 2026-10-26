import { useMemo, useState } from 'react';
import { ROLES } from '../lib/actions';
import type { Match, Player, VEvent } from '../lib/api';
import { AttackSection } from './analysis/AttackSection';
import { DefenseSection } from './analysis/DefenseSection';
import { ErrorsSection } from './analysis/ErrorsSection';
import { OverviewSection } from './analysis/OverviewSection';
import { PlayersSection } from './analysis/PlayersSection';
import { RotationsSection } from './analysis/RotationsSection';
import { ServePassSection } from './analysis/ServePassSection';
import { SettingSection } from './analysis/SettingSection';
import { judge, PlayContext, TONE_NOTE, Val, type Tone } from './analysis/ui';
import { dec, pct, playerStats, roleStats, type StatLine } from '../lib/stats';
import { CourtMaps } from './CourtMaps';

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


const roleName = (code: string) => ROLES.find((r) => r.code === code)?.label ?? code;

type Section = 'overview' | 'rotations' | 'attack' | 'servepass' | 'setting' | 'defense' | 'errors' | 'players' | 'tables' | 'court';
const SECTIONS: [Section, string][] = [
  ['overview', 'Overview'], ['rotations', 'Rotations'], ['attack', 'Attack'], ['servepass', 'Serve & pass'], ['setting', 'Setting'], ['defense', 'Defence'],
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

  const rows = useMemo(() => playerStats(players, confirmed).filter((r) => r.count > 0), [players, confirmed]);
  const roles = useMemo(() => roleStats(players, confirmed), [players, confirmed]);
  if (!confirmed.length) return <p className="muted small">No confirmed tags yet. Start tagging to see stats.</p>;

  const cols = COLUMNS[tab === 'roles' ? 'overview' : tab];
  return (
    <PlayContext.Provider value={onPlay ?? null}>
    <div className="stats">
      {/* All topics visible at once, each in its own colour, so none is missed. */}
      <div className="stats-sections" data-tour="sections">
        {SECTIONS.map(([k, label]) => (
          <button key={k} className={`sec-btn sec-${k} ${section === k ? 'on' : ''}`} onClick={() => pickSection(k)} aria-pressed={section === k}>{label}</button>
        ))}
      </div>
      <details className="tone-note muted small" data-tour="tone">
        <summary>How green ▲ / red ▼ are decided</summary>
        <p>{TONE_NOTE}</p>
      </details>

      {section === 'overview' && <OverviewSection players={players} events={confirmed} matches={matches} />}
      {section === 'rotations' && <RotationsSection players={players} events={confirmed} matches={matches} />}
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

      {section === 'court' && <CourtMaps players={players} events={confirmed} />}
    </div>
    </PlayContext.Provider>
  );
}

const ROLE_COLS: { h: string; v: (s: StatLine) => CellV }[] = [
  { h: 'Pts', v: (s) => s.points }, { h: 'Eff', v: (s) => t(dec(s.attackEff, 3), s.attempts >= 3 ? judge.eff(s.attackEff) : null) }, { h: 'Ace', v: (s) => s.aces },
  { h: 'Pass', v: (s) => t(dec(s.recAvg), s.receptions >= 5 ? judge.passAvg(s.recAvg) : null) }, { h: 'Dig', v: (s) => s.digs }, { h: 'BS', v: (s) => s.blockPoints }, { h: 'Err', v: (s) => s.errors },
];

const cellOut = (c: CellV) => (typeof c === 'object' ? <Val tone={c.tone}>{c.text}</Val> : c);

