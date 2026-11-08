import { More } from './More';
import { useMemo, useState } from 'react';
import { GroupedColumns, RAMP, SERIES } from '../../charts/Charts';
import type { Player, VEvent } from '../../lib/api';
import { buildRallies, SERVES } from '../../lib/sequence';
import { DEPTHS, depth, eff, errorKind, errorPct, ourZone, pointPct, splitBy, tally, targetDistance, theirZone } from '../../lib/trajectory';
import { CourtFull } from '../CourtFull';
import type { PlotPoint } from '../CourtHalf';
import { who } from './AttackSection';
import { avg2, diverge, eff3, HalfZones, judge, meters, pct, plural, ratio, sequential, StatFigure, Swatch, type ZoneValue, sample } from './ui';

const ZONE_ORDER = [4, 3, 2, 5, 6, 1];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Serve (where we serve, what it earns, how we miss) and serve-receive (who passes how
 * well, from where). [only]: one player's serves and passes (player pages).
 */
export function ServePassSection({ players: all, events, only }: { players: Player[]; events: VEvent[]; only?: number }) {
  const players = only == null ? all : all.filter((p) => p.id === only);
  const mine = (e: VEvent) => only == null || e.player_id === only;
  const [receiver, setReceiver] = useState<number | null>(only ?? null);
  const serves = useMemo(() => events.filter((e) => SERVES.includes(e.action) && mine(e)), [events, only]);
  const passes = useMemo(() => events.filter((e) => e.action === 'receive' && e.value != null && mine(e)), [events, only]);
  const rallies = useMemo(() => buildRallies(events), [events]);

  const servers = players.map((p) => ({ p, list: serves.filter((e) => e.player_id === p.id) })).filter((r) => r.list.length).sort((a, b) => b.list.length - a.list.length);
  const receivers = players.map((p) => ({ p, list: passes.filter((e) => e.player_id === p.id) })).filter((r) => r.list.length).sort((a, b) => b.list.length - a.list.length);
  const shownPasses = receiver == null ? passes : passes.filter((e) => e.player_id === receiver);

  // Where our serves landed (opponent court), with the ace %.
  const serveZones = splitBy(serves, (e) => { const z = theirZone(e); return z == null ? null : String(z); }, ['1', '2', '3', '4', '5', '6']);
  const maxServe = Math.max(1, ...[...serveZones.values()].map((t) => t.n));
  const serveZoneValues = new Map<number, ZoneValue>();
  const placed = [...serveZones.values()].reduce((a, t) => a + t.n, 0);
  for (const [z, t] of serveZones) {
    if (!t.n) continue;
    serveZoneValues.set(Number(z), { fill: sequential(t.n / maxServe), main: pct(t.n / Math.max(1, placed)), sub: t.points ? `${t.n} · ${plural(t.points, 'ace')}` : `${plural(t.n, 'serve')}`, title: `Zone ${z}: ${t.n} serves, ${t.points} aces` });
  }
  const serveDepth = splitBy(serves, depth, DEPTHS.map((d) => d.key));

  // Pass quality by the zone where the serve was received.
  const passZoneValues = new Map<number, ZoneValue>();
  for (const z of ZONE_ORDER) {
    const vs = shownPasses.filter((e) => ourZone(e) === z).map((e) => e.value!);
    if (!vs.length) continue;
    const a = mean(vs)!;
    passZoneValues.set(z, { fill: diverge(a, 1.8, 1), main: a.toFixed(1), sub: `${vs.length} passes`, title: `Zone ${z}: ${vs.length} passes, average ${a.toFixed(2)}` });
  }

  // Side-out % by the grade of the first pass: how much a good pass is worth.
  const soByGrade = [3, 2, 1, 0].map((g) => {
    const rs = rallies.filter((r) => r.weServed === false && r.won != null && r.touches[0]?.action === 'receive' && r.touches[0].value === g && mine(r.touches[0]));
    return { g, n: rs.length, won: rs.filter((r) => r.won).length };
  });

  const passDots: PlotPoint[] = shownPasses.filter((e) => e.x != null && e.y != null)
    .map((e) => ({ key: e.id, x: e.x!, y: e.y!, color: RAMP[e.value!], title: `${who(players.find((p) => p.id === e.player_id) ?? { number: null, name: '?' } as Player)} pass ${e.value}` }));
  const forWho = receiver == null ? '' : ` · ${who(players.find((p) => p.id === receiver)!)}`;

  return (
    <div className="charts">
      {serves.length > 0 && <>
      <h3 className="section-title">Serve</h3>
      <StatFigure title="Servers" subtitle="Serve efficiency = (aces − errors) / serves. Error kinds from where the missed serve went."
        rows={servers} rowKey={(r) => r.p.id}
        first={{ h: 'Player', cell: (r) => who(r.p) }}
        columns={[
          { h: 'Serves', cell: (r) => r.list.length },
          { h: 'Aces', cell: (r) => r.list.filter((e) => e.action === 'ace').length },
          { h: 'Err', cell: (r) => r.list.filter((e) => e.action === 'serve_error').length },
          { h: 'Ace%', cell: (r) => { const t = tally(r.list); return { text: pct(pointPct(t)), tone: sample(judge.acePct(pointPct(t)), t.n) }; } },
          { h: 'Err%', cell: (r) => { const t = tally(r.list); return { text: pct(errorPct(t)), tone: sample(judge.serveErrPct(errorPct(t)), t.n) }; } },
          { h: 'Eff', cell: (r) => { const t = tally(r.list); return { text: eff3(eff(t)), tone: sample(judge.eff(eff(t)), t.n) }; } },
          { h: 'Net', title: 'Errors into the net', cell: (r) => r.list.filter((e) => errorKind(e) === 'net').length },
          { h: 'Long', title: 'Errors out long', cell: (r) => r.list.filter((e) => errorKind(e) === 'long').length },
          { h: 'Wide', title: 'Errors out wide', cell: (r) => r.list.filter((e) => errorKind(e) === 'wide').length },
        ]}
        play={(r) => r.list.filter((e) => e.action !== 'serve')} playLabel="Aces/err" />

      </>}

      {passes.length > 0 && <>
      <h3 className="section-title">Serve receive</h3>
      <StatFigure title="Receivers" subtitle="Pass grade 0–3 (3 = perfect). Distance = how far the pass landed from the target (1 m off the net, right of centre)."
        rows={receivers} rowKey={(r) => r.p.id}
        first={{ h: 'Player', cell: (r) => who(r.p) }}
        columns={[
          { h: 'Passes', cell: (r) => r.list.length },
          { h: 'Avg', cell: (r) => { const a = mean(r.list.map((e) => e.value!)); return { text: avg2(a), tone: sample(judge.passAvg(a), r.list.length) }; } },
          { h: '3s', title: 'Perfect passes', cell: (r) => { const v = ratio(r.list.filter((e) => e.value === 3).length, r.list.length); return { text: pct(v), tone: sample(judge.perfectPct(v), r.list.length) }; } },
          { h: '0s', title: 'Reception errors (aces against us)', cell: (r) => { const n = r.list.filter((e) => e.value === 0).length; return { text: n, tone: judge.errors(n, r.list.length) }; } },
          { h: 'To target', cell: (r) => { const d = mean(r.list.map(targetDistance).filter((v): v is number => v != null)); return { text: meters(d), tone: sample(judge.distance(d), r.list.length) }; } },
          { h: 'Weakest zone', title: 'Zone with the lowest average (3+ passes)', cell: (r) => {
            const zs = ZONE_ORDER.map((z) => ({ z, vs: r.list.filter((e) => ourZone(e) === z).map((e) => e.value!) })).filter((x) => x.vs.length >= 3);
            const w = zs.sort((a, b) => mean(a.vs)! - mean(b.vs)!)[0];
            return w ? { text: `Z${w.z} (${mean(w.vs)!.toFixed(1)})`, tone: judge.passAvg(mean(w.vs)) === 'bad' ? 'bad' : null } : '–';
          } },
        ]}
        play={(r) => r.list.filter((e) => (e.value ?? 3) <= 1)} playLabel="Poor" />

      <GroupedColumns title="Side-out % by the first pass" subtitle="Rallies the opponent served: how often we won the point after a pass of each grade"
        categories={soByGrade.map((x) => `Pass ${x.g}`)}
        series={[{ name: 'Points won', color: SERIES.blue, values: soByGrade.map((x) => ratio(x.won, x.n)), notes: soByGrade.map((x) => `${x.won}/${x.n}`) }]}
        yTitle="Side-out %" fmt={pct} yDomain={[0, 1]} />

      </>}
      <More id="servepass">
      {serves.length > 0 && <>
      <h3 className="section-title">Serve</h3>
      <HalfZones title="Where our serves land" subtitle="Share of our serves per opponent zone (their numbering), with the aces"
        half="theirs" values={serveZoneValues}
        legend={<><Swatch fill={sequential(1)} label="Most serves" /><Swatch fill={sequential(0.15)} label="Few" /></>} />

      <StatFigure title="Serve depth" subtitle="How deep the serves landed; short serves pull the passers forward"
        rows={DEPTHS.filter((d) => d.key !== 'out').map((d) => ({ d, t: serveDepth.get(d.key)! })).filter((r) => r.t.n > 0)}
        rowKey={(r) => r.d.key}
        first={{ h: 'Depth', cell: (r) => r.d.label }}
        columns={[
          { h: 'Serves', cell: (r) => r.t.n },
          { h: 'Aces', cell: (r) => r.t.points },
          { h: 'Ace%', cell: (r) => ({ text: pct(pointPct(r.t)), tone: sample(judge.acePct(pointPct(r.t)), r.t.n) }) },
        ]} />

      </>}
      {passes.length > 0 && <>
      <h3 className="section-title">Serve receive</h3>
      {only == null && (
        <select className="input" value={receiver ?? ''} onChange={(e) => setReceiver(e.target.value ? Number(e.target.value) : null)}>
          <option value="">All receivers</option>
          {receivers.map(({ p, list }) => <option key={p.id} value={p.id}>{who(p)} ({list.length} passes)</option>)}
        </select>
      )}

      <HalfZones title={`Pass quality by where the serve was taken${forWho}`} subtitle="Average grade per zone of our court (from the first tap: where the ball was received)"
        half="ours" values={passZoneValues}
        legend={<><Swatch fill={diverge(2.8, 1.8, 1)} label="Good (2.5+)" /><Swatch fill={diverge(1.8, 1.8, 1)} label="~1.8" /><Swatch fill={diverge(0.8, 1.8, 1)} label="Poor" /></>} />

      {(() => {
        const rows = receivers.filter((r) => r.list.length >= 3);
        return rows.length ? (
          <StatFigure title="Who passes where" subtitle="Average grade per receiver and zone (passes in brackets)"
            rows={rows} rowKey={(r) => r.p.id}
            first={{ h: 'Player', cell: (r) => who(r.p) }}
            columns={ZONE_ORDER.filter((z) => rows.some((r) => r.list.some((e) => ourZone(e) === z))).map((z) => ({
              h: `Z${z}`,
              cell: (r: (typeof rows)[number]) => {
                const vs = r.list.filter((e) => ourZone(e) === z).map((e) => e.value!);
                if (!vs.length) return '·';
                const a = mean(vs)!;
                return { text: `${a.toFixed(1)} (${vs.length})`, tone: vs.length >= 3 ? judge.passAvg(a) : null };
              },
            }))} />
        ) : null;
      })()}

      {passDots.length > 0 && (
        <figure className="chart paper">
          <figcaption>
            <div className="chart-title"><b>Where the passes went{forWho}</b></div>
            <span className="chart-sub">Each dot is a pass, coloured by grade; the ring is the target</span>
            <span className="chart-legend">{[0, 1, 2, 3].map((g) => <Swatch key={g} fill={RAMP[g]} label={`Grade ${g}`} />)}</span>
          </figcaption>
          <div className="plot-wrap paper"><CourtFull points={passDots} showTarget yRange={[-3, 10.5]} /></div>
        </figure>
      )}
      </>}
      </More>
    </div>
  );
}
