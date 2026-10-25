import { useMemo } from 'react';
import { GroupedColumns, SERIES } from '../../charts/Charts';
import type { Match, Player, VEvent } from '../../lib/api';
import { buildRallies, phaseScoring, SERVES, transitionConversion, winByLength } from '../../lib/sequence';
import { teamLine } from '../../lib/stats';
import { eff, tally } from '../../lib/trajectory';
import { AnalysisCharts } from '../AnalysisCharts';
import { insightsFor } from './insights';
import { MomentumBlock, SetsTable } from './Momentum';
import { avg2, eff3, judge, pct, plural, ratio, Val, type Tone } from './ui';

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value"><Val tone={tone}>{value}</Val></span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

/** Overview: the team's headline numbers, what went well and what to work on, then the charts. */
export function OverviewSection({ players, events, matches }: { players: Player[]; events: VEvent[]; matches?: Match[] }) {
  const rallies = useMemo(() => buildRallies(events), [events]);
  const ph = phaseScoring(rallies);
  const tc = transitionConversion(rallies);
  const team = teamLine(events);
  const sv = tally(events.filter((e) => SERVES.includes(e.action)));
  const items = useMemo(() => insightsFor(events.filter((e) => e.player_id != null), events, 'team', players), [events, players]);
  const good = items.filter((i) => i.tone === 'good').slice(0, 4);
  const bad = items.filter((i) => i.tone === 'bad').slice(0, 5);
  const lengths = winByLength(rallies).filter((b) => b.n > 0);

  return (
    <div className="charts">
      <div className="kpis">
        <Kpi label="Side-out" value={pct(ph.sideoutPct)} sub={`${ph.sideout.won}/${ph.sideout.n} on their serve`} tone={ph.sideout.n >= 8 ? judge.sideout(ph.sideoutPct) : null} />
        <Kpi label="Break point" value={pct(ph.breakPct)} sub={`${ph.break.won}/${ph.break.n} on our serve`} tone={ph.break.n >= 8 ? judge.break(ph.breakPct) : null} />
        <Kpi label="Attack eff." value={eff3(team.attackEff)} sub={`${team.kills}K ${team.attackErrors}E / ${team.attempts}`} tone={team.attempts >= 5 ? judge.eff(team.attackEff) : null} />
        <Kpi label="Pass avg" value={avg2(team.recAvg)} sub={`${team.receptions} passes`} tone={team.receptions >= 5 ? judge.passAvg(team.recAvg) : null} />
        <Kpi label="Serve eff." value={eff3(eff(sv))} sub={`${plural(sv.points, 'ace')} · ${plural(sv.errors, 'error')}`} tone={sv.n >= 6 ? judge.eff(eff(sv)) : null} />
        <Kpi label="Transition" value={pct(tc.killPct)} sub={`kills from ${tc.n} digs`} tone={tc.n >= 8 ? judge.conversion(tc.killPct) : null} />
        <Kpi label="+/−" value={team.plusMinus > 0 ? `+${team.plusMinus}` : String(team.plusMinus)} sub={`${team.points} won · ${team.errors} given`} tone={judge.plusMinus(team.plusMinus)} />
      </div>

      {(good.length > 0 || bad.length > 0) && (
        <section className="findings focus-box">
          <div className="focus-cols">
            {good.length > 0 && <div><b className="tone-good">▲ What went well</b><ul>{good.map((i, k) => <li key={k}>{i.text}</li>)}</ul></div>}
            {bad.length > 0 && <div><b className="tone-bad">▼ To work on</b><ul>{bad.map((i, k) => <li key={k}>{i.text}</li>)}</ul></div>}
          </div>
        </section>
      )}

      <SetsTable events={events} />
      <MomentumBlock players={players} rallies={rallies} />

      {lengths.length > 1 && (
        <GroupedColumns title="Points won by rally length" subtitle="By our touches in the rally (1 = it ended on our serve or first pass): do we win the quick points or the long fights?"
          categories={lengths.map((b) => b.label)}
          series={[{ name: 'Won', color: SERIES.blue, values: lengths.map((b) => ratio(b.won, b.n)), notes: lengths.map((b) => `${b.won}/${b.n}`) }]}
          yTitle="Rallies won" fmt={pct} yDomain={[0, 1]} />
      )}

      <AnalysisCharts players={players} events={events} matches={matches} />
    </div>
  );
}
