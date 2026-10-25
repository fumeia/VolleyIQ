import { useMemo } from 'react';
import { BarChart, GroupedColumns, SERIES } from '../../charts/Charts';
import type { Player, VEvent } from '../../lib/api';
import { attackContexts, buildRallies, realAssists, SETS, type AttackContext } from '../../lib/sequence';
import { eff, errorPct, FRONT_ROW_FROM, pointPct, tally } from '../../lib/trajectory';
import { signColor, who } from './AttackSection';
import { eff3, judge, pct, ratio, StatFigure, sample } from './ui';

/** Where a set went along the net: to the left (zone 4), middle, right (zone 2), or the back row (as for attacks). */
export function setLane(e: Pick<VEvent, 'x' | 'y'>): 'left' | 'middle' | 'right' | 'back' | null {
  if (e.x == null || e.y == null) return null;
  if (e.y < FRONT_ROW_FROM) return 'back'; // back-row sets go up to 1 m in front of the 3 m line
  return e.x < 3 ? 'left' : e.x < 6 ? 'middle' : 'right';
}
const LANES: [ReturnType<typeof setLane> & string, string][] = [['left', 'Left (zone 4)'], ['middle', 'Middle (zone 3)'], ['right', 'Right (zone 2)'], ['back', 'Back row']];
const inSystem = (c: AttackContext) => c.phase === 'sideout' && c.quality != null && c.quality >= 2;

/** Setting: distribution to the hitters, assists, and what out-of-system sets cost. */
export function SettingSection({ players, events }: { players: Player[]; events: VEvent[] }) {
  const rallies = useMemo(() => buildRallies(events), [events]);
  const ctx = useMemo(() => attackContexts(rallies), [rallies]);
  const assists = useMemo(() => realAssists(rallies), [rallies]);
  const sets = events.filter((e) => SETS.includes(e.action));
  const setAttacks = ctx.filter((c) => c.set && c.attack.player_id != null);
  if (!sets.length) return <p className="muted small">No sets tagged yet.</p>;

  const setters = players.map((p) => ({ p, list: sets.filter((e) => e.player_id === p.id) })).filter((r) => r.list.length).sort((a, b) => b.list.length - a.list.length);
  const hitters = players.map((p) => ({ p, list: setAttacks.filter((c) => c.attack.player_id === p.id) })).filter((r) => r.list.length).sort((a, b) => b.list.length - a.list.length);
  const share = (n: number, of: number) => pct(ratio(n, of));
  const inSys = setAttacks.filter(inSystem);
  const outSys = setAttacks.filter((c) => !inSystem(c));

  const bySetType = [
    { label: 'Set by the setter', list: setAttacks.filter((c) => c.set!.action === 'set') },
    { label: 'Bump set (non-setter)', list: setAttacks.filter((c) => c.set!.action === 'assist') },
  ];
  const lanes = LANES.map(([k, label]) => ({ k, label, list: setAttacks.filter((c) => setLane(c.set!) === k) }));
  const lanesWithData = lanes.filter((l) => l.list.length);

  return (
    <div className="charts">
      <StatFigure title="Setters" subtitle="Assists = sets whose next touch was our kill. Bump sets = sets by a non-setter."
        rows={setters} rowKey={(r) => r.p.id}
        first={{ h: 'Player', cell: (r) => who(r.p) }}
        columns={[
          { h: 'Sets', cell: (r) => r.list.length },
          { h: 'Assists', cell: (r) => assists.get(r.p.id) ?? 0 },
          { h: 'Ast%', title: 'Assists per set that led to an attack', cell: (r) => {
            const n = setAttacks.filter((c) => c.set!.player_id === r.p.id).length;
            const v = ratio(assists.get(r.p.id) ?? 0, n);
            return { text: pct(v), tone: sample(judge.killPct(v), n), title: `${n} sets led to an attack` };
          } },
          { h: 'Bump', cell: (r) => r.list.filter((e) => e.action === 'assist').length },
          { h: 'Errors', cell: (r) => { const n = r.list.filter((e) => e.action === 'set_error' || e.action === 'assist_error').length; return { text: n, tone: judge.errors(n, r.list.length) }; } },
        ]} />

      <StatFigure title="Set distribution" subtitle="Who got the set, overall and by situation (in system = after a pass of 2 or 3; out of system = poor pass or transition). Eff = how the hitter converted it."
        rows={hitters} rowKey={(r) => r.p.id}
        first={{ h: 'Hitter', cell: (r) => who(r.p) }}
        columns={[
          { h: 'Sets', cell: (r) => r.list.length },
          { h: 'Share', cell: (r) => share(r.list.length, setAttacks.length) },
          { h: 'In sys.', title: 'Share of in-system sets', cell: (r) => share(r.list.filter(inSystem).length, inSys.length) },
          { h: 'Out sys.', title: 'Share of out-of-system sets', cell: (r) => share(r.list.filter((c) => !inSystem(c)).length, outSys.length) },
          { h: 'Eff', cell: (r) => { const t = tally(r.list.map((c) => c.attack)); return { text: eff3(eff(t)), tone: sample(judge.eff(eff(t)), t.n, 3) }; } },
          { h: 'K%', cell: (r) => { const t = tally(r.list.map((c) => c.attack)); return { text: pct(pointPct(t)), tone: sample(judge.killPct(pointPct(t)), t.n) }; } },
        ]}
        play={(r) => r.list.flatMap((c) => [c.set!, c.attack])} />

      <GroupedColumns title="In system vs out of system" subtitle="Kill % and error % of the attack after the set, in and out of system"
        categories={['In system', 'Out of system']}
        series={[
          { name: 'Kill %', color: SERIES.aqua, values: [inSys, outSys].map((l) => pointPct(tally(l.map((c) => c.attack)))), notes: [inSys, outSys].map((l) => `${l.length} attacks`) },
          { name: 'Error %', color: SERIES.orange, values: [inSys, outSys].map((l) => errorPct(tally(l.map((c) => c.attack)))), notes: [inSys, outSys].map((l) => `${l.length} attacks`) },
        ]}
        yTitle="Share of attacks" fmt={pct} yDomain={[0, 1]} />

      <BarChart title="Setter set vs bump set" subtitle="Attack efficiency after each kind of set; green = plus, red = minus"
        rows={bySetType.filter((b) => b.list.length).map((b) => {
          const t = tally(b.list.map((c) => c.attack));
          return { label: b.label, value: eff(t), note: `${t.points}-${t.errors}/${t.n}` };
        })}
        valueTitle="Attack efficiency" fmt={eff3} colorOf={signColor} />

      {lanesWithData.length > 0 && (
        <StatFigure title="Where the sets went" subtitle="From the second tap of each set: along the net or to the back row, and how the attack after it went"
          rows={lanesWithData} rowKey={(r) => r.k}
          first={{ h: 'Set to', cell: (r) => r.label }}
          columns={[
            { h: 'Sets', cell: (r) => r.list.length },
            { h: 'Share', cell: (r) => share(r.list.length, lanesWithData.reduce((a, l) => a + l.list.length, 0)) },
            { h: 'K%', cell: (r) => { const t = tally(r.list.map((c) => c.attack)); return { text: pct(pointPct(t)), tone: sample(judge.killPct(pointPct(t)), t.n) }; } },
            { h: 'Eff', cell: (r) => { const t = tally(r.list.map((c) => c.attack)); return { text: eff3(eff(t)), tone: sample(judge.eff(eff(t)), t.n, 3) }; } },
          ]} />
      )}
    </div>
  );
}
