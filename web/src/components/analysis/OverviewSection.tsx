import { useMemo } from 'react';
import { t } from '../../lib/i18n';
import { GroupedColumns, SERIES } from '../../charts/Charts';
import type { Match, Player, VEvent } from '../../lib/api';
import { buildRallies, phaseScoring, SERVES, transitionConversion, winByLength } from '../../lib/sequence';
import { teamLine } from '../../lib/stats';
import { eff, tally } from '../../lib/trajectory';
import { AnalysisCharts } from '../AnalysisCharts';
import { insightsFor } from './insights';
import { MomentumBlock, SetsTable } from './Momentum';
import { avg2, eff3, judge, pct, ratio, Val, type Tone } from './ui';

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{t(label)}</span>
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
        <Kpi label="Side-out" value={pct(ph.sideoutPct)} sub={t('{a}/{b} on their serve', { a: ph.sideout.won, b: ph.sideout.n })} tone={ph.sideout.n >= 8 ? judge.sideout(ph.sideoutPct) : null} />
        <Kpi label="Break point" value={pct(ph.breakPct)} sub={t('{a}/{b} on our serve', { a: ph.break.won, b: ph.break.n })} tone={ph.break.n >= 8 ? judge.break(ph.breakPct) : null} />
        <Kpi label="Attack eff." value={eff3(team.attackEff)} sub={`${team.kills}K ${team.attackErrors}E / ${team.attempts}`} tone={team.attempts >= 5 ? judge.eff(team.attackEff) : null} />
        <Kpi label="Pass avg" value={avg2(team.recAvg)} sub={t('{n} passes', { n: team.receptions })} tone={team.receptions >= 5 ? judge.passAvg(team.recAvg) : null} />
        <Kpi label="Serve eff." value={eff3(eff(sv))} sub={`${sv.points === 1 ? t('1 ace') : t('{n} aces', { n: sv.points })} · ${sv.errors === 1 ? t('1 error') : t('{n} errors', { n: sv.errors })}`} tone={sv.n >= 6 ? judge.eff(eff(sv)) : null} />
        <Kpi label="Transition" value={pct(tc.killPct)} sub={t('kills from {n} digs', { n: tc.n })} tone={tc.n >= 8 ? judge.conversion(tc.killPct) : null} />
        <Kpi label="+/−" value={team.plusMinus > 0 ? `+${team.plusMinus}` : String(team.plusMinus)} sub={`${team.points === 1 ? t('1 point') : t('{n} points', { n: team.points })} · ${team.errors === 1 ? t('1 error') : t('{n} errors', { n: team.errors })}`} tone={judge.plusMinus(team.plusMinus)} />
      </div>

      {(good.length > 0 || bad.length > 0) && (
        <section className="findings focus-box">
          <div className="focus-cols">
            {good.length > 0 && <div><b className="tone-good">▲ {t('What went well')}</b><ul>{good.map((i, k) => <li key={k}>{i.text}</li>)}</ul></div>}
            {bad.length > 0 && <div><b className="tone-bad">▼ {t('To work on')}</b><ul>{bad.map((i, k) => <li key={k}>{i.text}</li>)}</ul></div>}
          </div>
        </section>
      )}

      <SetsTable events={events} />
      <MomentumBlock players={players} rallies={rallies} />

      {lengths.length > 1 && (
        <GroupedColumns title="Points won by rally length" subtitle="Share of rallies won, by the number of our touches in the rally (1 = it ended on our serve or first pass)"
          categories={lengths.map((b) => b.label)}
          series={[{ name: 'Won', color: SERIES.blue, values: lengths.map((b) => ratio(b.won, b.n)), notes: lengths.map((b) => `${b.won}/${b.n}`) }]}
          yTitle="Rallies won" fmt={pct} yDomain={[0, 1]} />
      )}

      <AnalysisCharts players={players} events={events} matches={matches} />
    </div>
  );
}
