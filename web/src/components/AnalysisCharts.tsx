import { lineupsOf } from '../lib/practice';
import { useMemo } from 'react';
import { BarChart, GroupedColumns, LineChart, Scatter, SERIES } from '../charts/Charts';
import type { Match, Player, VEvent } from '../lib/api';
import { breakPct, coachPayload, keyFindings, rotationStats, sideOutPct } from '../lib/analysis';
import { playerStats, statLine } from '../lib/stats';
import { pointSources, scoreFlow } from '../report/analytics';
import { CoachSummary } from './CoachSummary';
import { inferRotations, rotationTable } from '../lib/rotationInfer';
import { buildRallies, phaseScoring } from '../lib/sequence';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const eff = (v: number) => v.toFixed(2).replace(/^(-?)0\./, '$1.');
const who = (p: Player) => `#${p.number ?? '–'} ${p.name.split(' ')[0]}`;

/**
 * Analysis charts with proper axes: score progression, attack, reception, serve,
 * rotations, point sources, zones, and (for several matches) the season trend.
 */
export function AnalysisCharts({ players, events, matches, part }: { players: Player[]; events: VEvent[]; matches?: Match[]; part: 'main' | 'more' }) {
  const all = useMemo(() => events.filter((e) => e.status === 'confirmed'), [events]);
  const rows = useMemo(() => playerStats(players, all).filter((r) => r.count > 0), [players, all]);
  const season = (matches?.length ?? 0) > 1;
  const flow = useMemo(() => (season ? [] : scoreFlow(all)), [all, season]);
  const lineups = useMemo(() => new Map((matches ?? []).map((m) => [m.id, lineupsOf(m)])), [matches]);
  const rotations = useMemo(() => rotationStats(all, lineups, players), [all, lineups, players]);
  const hasRotations = rotations.some((r) => r.receiving + r.serving > 0);
  // Without line-ups, the rotations come from the order in which our players served.
  const inferred = useMemo(() => (hasRotations ? [] : rotationTable(inferRotations(buildRallies(all), players))), [hasRotations, all, players]);
  const sources = useMemo(() => pointSources(all), [all]);

  if (!all.length) return part === 'more' ? null : <p className="muted small">No saved touches yet. Tag or review the match to see charts.</p>;

  const attackers = rows.filter((r) => r.stats.attempts > 0).sort((a, b) => b.stats.attempts - a.stats.attempts);
  const ordered = [...(matches ?? [])].sort((a, b) => (a.played_on ?? '').localeCompare(b.played_on ?? '') || a.id - b.id);
  const perMatch = (f: (evs: VEvent[]) => number | null) =>
    ordered.map((m, i) => ({ x: i + 1, y: f(all.filter((e) => e.match_id === m.id)) })).filter((p): p is { x: number; y: number } => p.y != null);
  const matchName = (x: number) => { const m = ordered[x - 1]; return m ? m.opponent ?? m.label : String(x); };

  // The few charts a player looks at first; the rest behind "More charts" (see OverviewSection).
  if (part === 'main') return (
    <div className="charts">
      {season && (
        <>
          <LineChart title={`Attack efficiency per match`} subtitle="(kills − errors) / attempts, in date order"
            series={[{ name: 'Attack eff.', color: SERIES.blue, points: perMatch((evs) => statLine(evs.filter((e) => e.player_id != null)).attackEff) }]}
            xTitle="Match" yTitle="Efficiency" yFmt={eff} xFmt={matchName} categorical refLine={{ y: 0, label: '0' }} />
          <LineChart title={`Pass average per match`} subtitle="Receive grade 0–3"
            series={[{ name: 'Pass avg', color: SERIES.blue, points: perMatch((evs) => statLine(evs).recAvg) }]}
            xTitle="Match" yTitle="Grade" yDomain={[0, 3]} yFmt={(v) => v.toFixed(1)} xFmt={matchName} categorical />
        </>
      )}
      {flow.map(({ set, points }) => {
        const last = points[points.length - 1];
        return (
          <LineChart key={set} title={`Set ${set} · score progression`} subtitle={`${last.us}–${last.them} after ${last.i} rallies`}
            series={[
              { name: 'Us', color: SERIES.blue, points: points.map((p) => ({ x: p.i, y: p.us })) },
              { name: 'Them', color: SERIES.orange, points: points.map((p) => ({ x: p.i, y: p.them })) },
            ]}
            xTitle="Rally" yTitle="Points" step />
        );
      })}

      {<Scatter title="Volume vs efficiency" subtitle="Each dot is a player: how often they attack and how well"
        points={attackers.map((r) => ({ x: r.stats.attempts, y: r.stats.attackEff ?? 0, label: `#${r.player.number ?? '–'}`, name: who(r.player) }))}
        xTitle="Attempts" yTitle="Efficiency" yFmt={eff} />}



      {!season && <BarChart title="How we scored" rows={sources.won.map((b) => ({ label: b.label, value: b.value }))} valueTitle="Points" color={SERIES.aqua} fmt={(v) => String(Math.round(v))} />}
    </div>
  );
  return (
    <div className="charts">
      {(() => {
        // The team's strengths and weaknesses are in the Overview box; this adds the rotations (needs line-ups).
        const team = statLine(all.filter((e) => e.player_id != null));
        const rot = keyFindings(team, [], [], rotations, []).filter((f) => f.text.startsWith('Side-out'));
        return rot.length ? (
          <section className="findings">
            <b>Rotations</b>
            <ul>{rot.map((f, i) => <li key={i}>{f.text}</li>)}</ul>
          </section>
        ) : null;
      })()}

      {<CoachSummary stats={coachPayload(players, all, lineups, season)} />}

      {season && (
        <>
          {<LineChart title="Side-out and break points per match" subtitle="Rallies won on their serve (side-out) and on ours (break point)"
            series={[
              { name: 'Side-out %', color: SERIES.blue, points: perMatch((evs) => phaseScoring(buildRallies(evs)).sideoutPct) },
              { name: 'Break %', color: SERIES.orange, points: perMatch((evs) => phaseScoring(buildRallies(evs)).breakPct) },
            ]}
            xTitle="Match" yTitle="Rallies won" yDomain={[0, 1]} yFmt={pct} xFmt={matchName} categorical />}
        </>
      )}


      {(hasRotations ? (
        <GroupedColumns title="Points won by rotation" subtitle="Named by the setter's position; side-out = on their serve, break = on ours"
          categories={rotations.map((r) => `S${r.rotation}`)}
          series={[
            { name: 'Side-out %', color: SERIES.blue, values: rotations.map(sideOutPct), notes: rotations.map((r) => `${r.sideOuts}/${r.receiving}`) },
            { name: 'Break %', color: SERIES.orange, values: rotations.map(breakPct), notes: rotations.map((r) => `${r.breaks}/${r.serving}`) },
          ]}
          yTitle="Points won" fmt={pct} yDomain={[0, 1]} />
      ) : (
        inferred.length >= 2 ? (
          <GroupedColumns title="Points won by rotation" subtitle={inferred[0].label.startsWith('S') ? "From our serve order (no line-up needed), named by the setter's position; side-out = on their serve, break = on ours" : 'From our serve order (no line-up needed), named by who is in position 1'}
            categories={inferred.map((r) => r.label)}
            series={[
              { name: 'Side-out %', color: SERIES.blue, values: inferred.map((r) => (r.received ? r.sideouts / r.received : null)), notes: inferred.map((r) => `${r.sideouts}/${r.received}`) },
              { name: 'Break %', color: SERIES.orange, values: inferred.map((r) => (r.served ? r.breaks / r.served : null)), notes: inferred.map((r) => `${r.breaks}/${r.served}`) },
            ]}
            yTitle="Points won" fmt={pct} yDomain={[0, 1]} />
        ) : <p className="muted small chart-note">Tag our serves (with the server) to see side-out and break-point % per rotation.</p>
      ))}

      {season && <BarChart title="How we scored" rows={sources.won.map((b) => ({ label: b.label, value: b.value }))} valueTitle="Points" color={SERIES.aqua} fmt={(v) => String(Math.round(v))} />}
      {<BarChart title="How the opponent scored" rows={sources.lost.map((b) => ({ label: b.label, value: b.value }))} valueTitle="Points" color={SERIES.orange} fmt={(v) => String(Math.round(v))} />}



    </div>
  );
}
