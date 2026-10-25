import { useMemo, useState } from 'react';
import { BarChart, GroupedColumns, SERIES, StackedBars } from '../../charts/Charts';
import type { Player, VEvent } from '../../lib/api';
import { ATTACKS, attackContexts, buildRallies, type AttackContext } from '../../lib/sequence';
import {
  attackOrigin, DEPTHS, depth, DIRECTIONS, direction, eff, errorPct, pointPct, result, splitBy, tally, theirZone, type Tally,
} from '../../lib/trajectory';
import { CourtFull, type PlotPath } from '../CourtFull';
import { diverge, eff3, enough, HalfZones, judge, pct, PlayBtn, StatFigure, Swatch, type ZoneValue } from './ui';

export const who = (p: Player) => `#${p.number ?? '–'} ${p.name.split(' ')[0]}`;
export const OUTCOME = { point: SERIES.aqua, play: SERIES.blue, error: SERIES.orange };
const GOOD_BAR = '#0ca30c', BAD_BAR = '#d03b3b';
export const signColor = (v: number) => (v >= 0 ? GOOD_BAR : BAD_BAR);

const phaseKey = (c: AttackContext | undefined) => {
  if (!c || c.phase === 'unknown') return null;
  if (c.phase === 'transition') return 'trans';
  return c.quality === 3 ? 'p3' : c.quality === 2 ? 'p2' : c.quality != null && c.quality <= 1 ? 'p1' : null;
};

/** Attack: who scores, from which first contact, which shots work, where. */
export function AttackSection({ players, events }: { players: Player[]; events: VEvent[] }) {
  const [focus, setFocus] = useState<number | null>(null);
  const [shots, setShots] = useState<'all' | 'point' | 'error' | 'play'>('all');
  const ctxById = useMemo(() => new Map(attackContexts(buildRallies(events)).map((c) => [c.attack.id, c])), [events]);
  const allAttacks = useMemo(() => events.filter((e) => ATTACKS.includes(e.action)), [events]);
  const attackers = useMemo(() => players
    .map((p) => ({ p, list: allAttacks.filter((e) => e.player_id === p.id) }))
    .filter((r) => r.list.length > 0)
    .sort((a, b) => b.list.length - a.list.length), [players, allAttacks]);
  const attacks = focus == null ? allAttacks : allAttacks.filter((e) => e.player_id === focus);
  if (!allAttacks.length) return <p className="muted small">No attacks tagged yet.</p>;

  const phaseOf = (list: VEvent[], ph: 'sideout' | 'transition') => tally(list.filter((e) => ctxById.get(e.id)?.phase === ph));
  const byPhase = splitBy(attacks, (e) => phaseKey(ctxById.get(e.id)), ['p3', 'p2', 'p1', 'trans']);
  const PHASES: [string, string][] = [['p3', 'Pass 3'], ['p2', 'Pass 2'], ['p1', 'Pass 0–1'], ['trans', 'Transition']];
  const dirs = splitBy(attacks, direction, DIRECTIONS.map((d) => d.key));
  const depths = splitBy(attacks, depth, DEPTHS.map((d) => d.key));
  const origins = splitBy(attacks, attackOrigin, ['4', '3', '2', 'back']);
  const zones = splitBy(attacks, (e) => { const z = theirZone(e); return z == null ? null : String(z); }, ['1', '2', '3', '4', '5', '6']);
  const withSpots = attacks.filter((e) => e.fx != null && e.x != null).length;

  const zoneValues = new Map<number, ZoneValue>();
  for (const [z, t] of zones) {
    if (!t.n) continue;
    zoneValues.set(Number(z), {
      fill: diverge(pointPct(t), 0.35, 0.35), main: pct(pointPct(t)), sub: `${t.points} K / ${t.n}`,
      title: `Zone ${z}: ${t.n} attacks, ${t.points} kills, ${t.errors} errors`,
    });
  }
  const paths: PlotPath[] = attacks
    .filter((e) => e.fx != null && e.fy != null && e.x != null && e.y != null && (shots === 'all' || result(e.action) === shots))
    .map((e) => ({ key: e.id, from: { x: e.fx!, y: e.fy! }, to: { x: e.x!, y: e.y! }, color: OUTCOME[result(e.action) ?? 'play'], title: e.action.replace('_', ' ') }));
  const forWho = focus == null ? '' : ` · ${who(players.find((p) => p.id === focus)!)}`;
  const tRow = (label: string, t: Tally, isDepth = false) => ({ label, t, depth: isDepth });

  return (
    <div className="charts">
      <select className="input" value={focus ?? ''} onChange={(e) => setFocus(e.target.value ? Number(e.target.value) : null)}>
        <option value="">All attackers</option>
        {attackers.map(({ p, list }) => <option key={p.id} value={p.id}>{who(p)} ({list.length} attacks)</option>)}
      </select>

      <StatFigure title="Attackers" subtitle="Efficiency = (kills − errors − blocked) / attempts. Side-out = first ball after our pass; transition = after a dig, block or free ball."
        rows={attackers} rowKey={(r) => r.p.id}
        first={{ h: 'Player', cell: (r) => who(r.p) }}
        columns={[
          { h: 'TA', title: 'Total attempts', cell: (r) => r.list.length },
          { h: 'K', cell: (r) => r.list.filter((e) => e.action === 'kill').length },
          { h: 'E', title: 'Errors (out / net)', cell: (r) => r.list.filter((e) => e.action === 'attack_error').length },
          { h: 'BA', title: 'Blocked', cell: (r) => r.list.filter((e) => e.action === 'attack_blocked').length },
          { h: 'K%', cell: (r) => { const t = tally(r.list); return { text: pct(pointPct(t)), tone: enough(t.n) ? judge.killPct(pointPct(t)) : null }; } },
          { h: 'Err%', cell: (r) => { const t = tally(r.list); return { text: pct(errorPct(t)), tone: enough(t.n) ? judge.errPct(errorPct(t)) : null }; } },
          { h: 'Eff', cell: (r) => { const t = tally(r.list); return { text: eff3(eff(t)), tone: enough(t.n, 3) ? judge.eff(eff(t)) : null }; } },
          { h: 'Side-out', title: 'Efficiency on the first ball after our pass', cell: (r) => { const t = phaseOf(r.list, 'sideout'); return { text: t.n ? eff3(eff(t)) : '–', tone: enough(t.n, 3) ? judge.eff(eff(t)) : null, title: `${t.n} attacks` }; } },
          { h: 'Trans.', title: 'Efficiency in transition (after a dig / free ball)', cell: (r) => { const t = phaseOf(r.list, 'transition'); return { text: t.n ? eff3(eff(t)) : '–', tone: enough(t.n, 3) ? judge.eff(eff(t)) : null, title: `${t.n} attacks` }; } },
          { h: 'Main shot', title: 'Most frequent direction', cell: (r) => {
            const d = splitBy(r.list, direction, DIRECTIONS.map((x) => x.key));
            const best = [...d.entries()].sort((a, b) => b[1].n - a[1].n)[0];
            return best && best[1].n ? `${DIRECTIONS.find((x) => x.key === best[0])!.label} ${pct(best[1].n / r.list.filter((e) => direction(e)).length)}` : '–';
          } },
        ]}
        play={(r) => r.list} />

      <GroupedColumns title={`Attack after the first contact${forWho}`}
        subtitle="Kill % and error % by the pass grade before the attack (transition = after a dig or free ball) — how much the attack depends on the pass"
        categories={PHASES.map(([, l]) => l)}
        series={[
          { name: 'Kill %', color: SERIES.aqua, values: PHASES.map(([k]) => pointPct(byPhase.get(k as 'p3')!)), notes: PHASES.map(([k]) => `${byPhase.get(k as 'p3')!.points}/${byPhase.get(k as 'p3')!.n}`) },
          { name: 'Error %', color: SERIES.orange, values: PHASES.map(([k]) => errorPct(byPhase.get(k as 'p3')!)), notes: PHASES.map(([k]) => `${byPhase.get(k as 'p3')!.errors}/${byPhase.get(k as 'p3')!.n}`) },
        ]}
        yTitle="Share of attacks" fmt={pct} yDomain={[0, 1]} />

      <StatFigure title={`Which shots work${forWho}`} subtitle={`From the two tapped spots (${withSpots} of ${attacks.length} attacks have both). Line < 15°, cross up to 50°, sharp cut beyond.`}
        rows={[
          ...DIRECTIONS.map((d) => tRow(d.label, dirs.get(d.key)!)),
          ...DEPTHS.filter((d) => d.key !== 'out').map((d) => tRow(`Landing in: ${d.label.toLowerCase()}`, depths.get(d.key)!, true)),
        ].filter((r) => r.t.n > 0)}
        rowKey={(r) => r.label}
        first={{ h: 'Shot', cell: (r) => r.label }}
        columns={[
          { h: 'Attacks', cell: (r) => r.t.n },
          { h: 'Share', cell: (r) => pct(r.t.n / Math.max(1, withSpots)) },
          { h: 'K%', cell: (r) => ({ text: pct(pointPct(r.t)), tone: enough(r.t.n) ? judge.killPct(pointPct(r.t)) : null }) },
          { h: 'Err%', cell: (r) => (r.depth ? '–' : { text: pct(errorPct(r.t)), tone: enough(r.t.n) ? judge.errPct(errorPct(r.t)) : null }) },
          { h: 'Eff', cell: (r) => (r.depth ? '–' : { text: eff3(eff(r.t)), tone: enough(r.t.n, 3) ? judge.eff(eff(r.t)) : null }) },
        ]}
        note="Landing rows count balls that came down in the court (errors land out), so they show the kill rate only." />

      {focus == null && (() => {
        const rows = attackers
          .map(({ p, list }) => ({ p, d: splitBy(list, direction, DIRECTIONS.map((x) => x.key)) }))
          .filter((r) => [...r.d.values()].reduce((a, t) => a + t.n, 0) >= 3);
        return rows.length ? (
          <StackedBars title="Shot mix per attacker" subtitle="Share of each attacker's shots by direction (attacks with both spots tapped)"
            keys={DIRECTIONS.map((d, i) => ({ name: d.label, color: [SERIES.blue, SERIES.orange, SERIES.aqua][i] }))}
            rows={rows.map((r) => ({ label: who(r.p), parts: DIRECTIONS.map((d) => r.d.get(d.key)!.n) }))} axisTitle="Share of shots" />
        ) : null;
      })()}

      <BarChart title={`Efficiency by where the attack was hit from${forWho}`} subtitle="Front row zones 4 (left), 3 (middle), 2 (right) and back-row attacks; green = plus, red = minus"
        rows={[['4', 'Zone 4 (left)'], ['3', 'Zone 3 (middle)'], ['2', 'Zone 2 (right)'], ['back', 'Back row']]
          .map(([k, label]) => ({ t: origins.get(k as '4')!, label }))
          .filter((r) => r.t.n > 0)
          .map((r) => ({ label: r.label, value: eff(r.t), note: `${r.t.points}-${r.t.errors}/${r.t.n}` }))}
        valueTitle="Efficiency" fmt={eff3} colorOf={signColor} />

      <HalfZones title={`Kill % by target zone${forWho}`} subtitle="Where our attacks landed on the opponent's court (their zone numbers), drawn as the camera sees it"
        half="theirs" values={zoneValues}
        legend={<><Swatch fill={diverge(0.7, 0.35, 0.35)} label="High kill %" /><Swatch fill={diverge(0.35, 0.35, 0.35)} label="~35%" /><Swatch fill={diverge(0, 0.35, 0.35)} label="Low" /></>} />

      {attacks.some((e) => e.fx != null && e.x != null) && (
        <figure className="chart paper">
          <figcaption>
            <div className="chart-title"><b>Shot chart{forWho}</b></div>
            <span className="chart-sub">Each arrow from where the ball was hit to where it went</span>
            <span className="chart-legend"><Swatch fill={OUTCOME.point} label="Kill" /><Swatch fill={OUTCOME.play} label="In play" /><Swatch fill={OUTCOME.error} label="Error / blocked" /></span>
          </figcaption>
          <div className="chips tight">
            {([['all', 'All'], ['point', 'Kills'], ['play', 'In play'], ['error', 'Errors']] as const).map(([k, l]) => (
              <button key={k} className={`chip ${shots === k ? 'on' : ''}`} onClick={() => setShots(k)}>{l}</button>
            ))}
            <PlayBtn list={attacks.filter((e) => shots === 'all' || result(e.action) === shots)} label="Watch these" />
          </div>
          <div className="plot-wrap paper"><CourtFull paths={paths} /></div>
        </figure>
      )}
    </div>
  );
}
