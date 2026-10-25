import { useMemo } from 'react';
import { BarChart, GroupedColumns, LineChart, RAMP, Scatter, SERIES, StackedBars } from '../charts/Charts';
import type { Match, Player, VEvent } from '../lib/api';
import { breakPct, rotationStats, serveRows, sideOutPct } from '../lib/analysis';
import { playerStats, statLine } from '../lib/stats';
import { attackZones, pointSources, receivers, scoreFlow } from '../report/analytics';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const eff = (v: number) => v.toFixed(2).replace(/^(-?)0\./, '$1.');
const who = (p: Player) => `#${p.number ?? '–'} ${p.name.split(' ')[0]}`;

/**
 * Analysis charts with proper axes: score progression, attack, reception, serve,
 * rotations, point sources, zones, and (for several matches) the season trend.
 */
export function AnalysisCharts({ players, events, matches }: { players: Player[]; events: VEvent[]; matches?: Match[] }) {
  const confirmed = useMemo(() => events.filter((e) => e.status === 'confirmed'), [events]);
  const rows = useMemo(() => playerStats(players, confirmed).filter((r) => r.count > 0), [players, confirmed]);
  const season = (matches?.length ?? 0) > 1;
  const flow = useMemo(() => (season ? [] : scoreFlow(confirmed)), [confirmed, season]);
  const lineups = useMemo(() => new Map((matches ?? []).map((m) => [m.id, m.lineups])), [matches]);
  const rotations = useMemo(() => rotationStats(confirmed, lineups, players), [confirmed, lineups, players]);
  const hasRotations = rotations.some((r) => r.receiving + r.serving > 0);
  const sources = useMemo(() => pointSources(confirmed), [confirmed]);
  const zones = useMemo(() => attackZones(confirmed), [confirmed]);
  const recv = useMemo(() => receivers(players, confirmed), [players, confirmed]);
  const serves = useMemo(() => serveRows(players, confirmed), [players, confirmed]);

  if (!confirmed.length) return <p className="muted small">No saved touches yet. Tag or review the match to see charts.</p>;

  const attackers = rows.filter((r) => r.stats.attempts > 0).sort((a, b) => b.stats.attempts - a.stats.attempts);
  const ordered = [...(matches ?? [])].sort((a, b) => (a.played_on ?? '').localeCompare(b.played_on ?? '') || a.id - b.id);
  const perMatch = (f: (evs: VEvent[]) => number | null) =>
    ordered.map((m, i) => ({ x: i + 1, y: f(confirmed.filter((e) => e.match_id === m.id)) })).filter((p): p is { x: number; y: number } => p.y != null);
  const matchName = (x: number) => { const m = ordered[x - 1]; return m ? m.opponent ?? m.label : String(x); };

  return (
    <div className="charts">
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

      {season && (
        <>
          <LineChart title="Attack efficiency per match" subtitle="(kills − errors) / attempts, in date order"
            series={[{ name: 'Attack eff.', color: SERIES.blue, points: perMatch((evs) => statLine(evs.filter((e) => e.player_id != null)).attackEff) }]}
            xTitle="Match" yTitle="Efficiency" yFmt={eff} xFmt={matchName} categorical refLine={{ y: 0, label: '0' }} />
          <LineChart title="Pass average per match" subtitle="Receive grade 0–3"
            series={[{ name: 'Pass avg', color: SERIES.blue, points: perMatch((evs) => statLine(evs).recAvg) }]}
            xTitle="Match" yTitle="Grade" yDomain={[0, 3]} yFmt={(v) => v.toFixed(1)} xFmt={matchName} categorical />
          <LineChart title="Side-out % per match" subtitle="Points won when the opponent served (needs line-ups)"
            series={[{ name: 'Side-out %', color: SERIES.blue, points: perMatch((evs) => {
              const r = rotationStats(evs, lineups, players).reduce((a, x) => ({ receiving: a.receiving + x.receiving, sideOuts: a.sideOuts + x.sideOuts }), { receiving: 0, sideOuts: 0 });
              return sideOutPct(r);
            }) }]}
            xTitle="Match" yTitle="Side-out" yDomain={[0, 1]} yFmt={pct} xFmt={matchName} categorical />
        </>
      )}

      <BarChart title="Attack efficiency by player" subtitle="(kills − errors) / attempts; blocked attacks count as errors"
        rows={attackers.map((r) => ({ label: who(r.player), value: r.stats.attackEff, note: `${r.stats.kills}-${r.stats.attackErrors}/${r.stats.attempts}` }))}
        valueTitle="Efficiency" fmt={eff} />

      <Scatter title="Volume vs efficiency" subtitle="Each dot is a player: how often they attack and how well"
        points={attackers.map((r) => ({ x: r.stats.attempts, y: r.stats.attackEff ?? 0, label: `#${r.player.number ?? '–'}`, name: who(r.player) }))}
        xTitle="Attempts" yTitle="Efficiency" yFmt={eff} />

      <StackedBars title="Reception quality by receiver" subtitle="Share of passes per grade (0 = error, 3 = perfect)"
        keys={[0, 1, 2, 3].map((g) => ({ name: `Grade ${g}`, color: RAMP[g] }))}
        rows={recv.map((r) => ({ label: who(r.player), parts: [...r.grades] }))} axisTitle="Share of passes" />

      <StackedBars title="Serve outcomes by server" subtitle="Aces, serves kept in play, and errors"
        keys={[{ name: 'Ace', color: SERIES.aqua }, { name: 'In play', color: SERIES.blue }, { name: 'Error', color: SERIES.orange }]}
        rows={serves.map((r) => ({ label: who(r.player), parts: [r.aces, r.inPlay, r.errors] }))} axisTitle="Share of serves" />

      {hasRotations ? (
        <GroupedColumns title="Points won by rotation" subtitle="Named by the setter's position; side-out = on their serve, break = on ours"
          categories={rotations.map((r) => `S${r.rotation}`)}
          series={[
            { name: 'Side-out %', color: SERIES.blue, values: rotations.map(sideOutPct), notes: rotations.map((r) => `${r.sideOuts}/${r.receiving}`) },
            { name: 'Break %', color: SERIES.orange, values: rotations.map(breakPct), notes: rotations.map((r) => `${r.breaks}/${r.serving}`) },
          ]}
          yTitle="Points won" fmt={pct} yDomain={[0, 1]} />
      ) : (
        <p className="muted small chart-note">Enter the line-ups (Review → line-up) to see side-out and break-point % per rotation.</p>
      )}

      <BarChart title="How we scored" rows={sources.won.map((b) => ({ label: b.label, value: b.value }))} valueTitle="Points" color={SERIES.aqua} fmt={(v) => String(Math.round(v))} />
      <BarChart title="How the opponent scored" rows={sources.lost.map((b) => ({ label: b.label, value: b.value }))} valueTitle="Points" color={SERIES.orange} fmt={(v) => String(Math.round(v))} />

      <GroupedColumns title="Attacks by target zone" subtitle="Kill % per zone of the opponent's court (number of attacks in the table)"
        categories={zones.map((z) => `Zone ${z.zone}`)}
        series={[{ name: 'Kill %', color: SERIES.blue, values: zones.map((z) => (z.attempts ? z.kills / z.attempts : null)), notes: zones.map((z) => `${z.kills}/${z.attempts}`) }]}
        yTitle="Kill %" fmt={pct} yDomain={[0, 1]} />
    </div>
  );
}
