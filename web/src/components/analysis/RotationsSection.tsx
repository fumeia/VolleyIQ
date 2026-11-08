import { More } from './More';
import { useMemo } from 'react';
import { GroupedColumns, SERIES } from '../../charts/Charts';
import type { Match, Player, VEvent } from '../../lib/api';
import { sheetStats, type MatchSheetFlow } from '../../lib/sheetFlow';
import { inferRotations, rotationTable, type RotationRally } from '../../lib/rotationInfer';
import { ATTACKS, attackContexts, buildRallies, SERVES } from '../../lib/sequence';
import { eff, errorPct, pointPct, tally } from '../../lib/trajectory';
import { who } from './AttackSection';
import { avg2, eff3, judge, pct, ratio, StatFigure, sample } from './ui';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Rotations (from the serve order, no line-up needed): for each one, how the pass,
 * the first-ball attack and our serve went, and who attacked: why a rotation wins
 * or loses its points.
 */
export function RotationsSection({ players, events, matches = [] }: { players: Player[]; events: VEvent[]; matches?: Match[] }) {
  const rallies = useMemo(() => buildRallies(events), [events]);
  const rot = useMemo(() => inferRotations(rallies, players), [rallies, players]);
  const table = rotationTable(rot);
  const ctx = useMemo(() => attackContexts(rallies), [rallies]);
  const sheets = matches.map((m) => m.sheet).filter((x): x is MatchSheetFlow => !!x);
  const fromSheet = sheets.length ? <SheetRotations sheets={sheets} players={players} /> : null;
  if (table.length < 2) return <div className="charts">{fromSheet}<p className="muted small">Tag our serves with the server to see the rotations from the tags (the serve order gives them).</p></div>;

  const byLabel = new Map<string, RotationRally[]>();
  for (const r of rot) if (r.label) byLabel.set(r.label, [...(byLabel.get(r.label) ?? []), r]);
  const ralliesOf = (label: string) => (byLabel.get(label) ?? []).map((x) => x.rally);
  const touchesOf = (label: string) => ralliesOf(label).flatMap((r) => r.touches);
  const attackIds = (label: string) => new Set(touchesOf(label).filter((e) => ATTACKS.includes(e.action)).map((e) => e.id));

  const setters = new Set(players.filter((p) => p.role === 'S').map((p) => p.id));
  const rows = table.map((t) => {
    const touches = touchesOf(t.label);
    const passes = touches.filter((e) => e.action === 'receive' && e.value != null);
    const ids = attackIds(t.label);
    const fb = ctx.filter((c) => c.phase === 'sideout' && ids.has(c.attack.id)).map((c) => c.attack);
    const serves = touches.filter((e) => SERVES.includes(e.action));
    // Main hitter: the setter's dumps and second-ball attacks don't count (role S, any number).
    const hitters = new Map<number, number>();
    for (const e of touches) if (ATTACKS.includes(e.action) && e.player_id != null && !setters.has(e.player_id)) hitters.set(e.player_id, (hitters.get(e.player_id) ?? 0) + 1);
    const top = [...hitters.entries()].sort((a, b) => b[1] - a[1])[0];
    const nAtt = [...hitters.values()].reduce((a, b) => a + b, 0);
    return { t, passes, fb, serves, top, nAtt };
  });

  const named = table.some((t) => t.label.startsWith('S'));
  return (
    <div className="charts">
      <p className="muted small">
        {named
          ? "From the order our players served in (no line-up needed). S1 = setter in position 1 (serving), S2 = setter in position 2, and so on."
          : 'From the order our players served in (no line-up needed), named by who is in position 1. Tag the setter with role S to get S1–S6 names.'}
      </p>
      <StatFigure title="Rotation report" subtitle="Receiving: side-out %, pass average and first-ball attack. Serving: break-point % and serve errors."
        rows={rows} rowKey={(r) => r.t.label}
        first={{ h: 'Rotation', cell: (r) => r.t.label }}
        columns={[
          { h: 'Side-out', cell: (r) => { const v = ratio(r.t.sideouts, r.t.received); return { text: pct(v), tone: r.t.received >= 5 ? judge.sideout(v) : null, title: `${r.t.sideouts}/${r.t.received}` }; } },
          { h: 'Pass', cell: (r) => { const a = mean(r.passes.map((e) => e.value!)); return { text: avg2(a), tone: sample(judge.passAvg(a), r.passes.length), title: `${r.passes.length} passes` }; } },
          { h: '1st-ball eff', title: 'Attack efficiency on the first ball after our pass', cell: (r) => { const t = tally(r.fb); return { text: eff3(eff(t)), tone: sample(judge.eff(eff(t)), t.n, 4), title: `${t.points}-${t.errors}/${t.n}` }; } },
          { h: 'Break', cell: (r) => { const v = ratio(r.t.breaks, r.t.served); return { text: pct(v), tone: r.t.served >= 5 ? judge.break(v) : null, title: `${r.t.breaks}/${r.t.served}` }; } },
          { h: 'Srv err', cell: (r) => { const t = tally(r.serves); return { text: pct(errorPct(t)), tone: sample(judge.serveErrPct(errorPct(t)), t.n) }; } },
          { h: 'Main hitter', title: 'Share of the attacks in this rotation (setter excluded)', cell: (r) => {
            if (!r.top) return '–';
            const p = players.find((x) => x.id === r.top![0]);
            return `${p ? who(p) : '?'} ${pct(r.top[1] / Math.max(1, r.nAtt))}`;
          } },
        ]}
        play={(r) => ralliesOf(r.t.label).filter((x) => x.won === false).map((x) => x.end ?? x.touches[x.touches.length - 1]).filter((e): e is VEvent => !!e)}
        playLabel="Lost" />

      <GroupedColumns title="Pass and first-ball attack per rotation" subtitle="Where the side-out breaks down: the pass (share of good passes, 2–3) or the attack after it (kill %)"
        categories={rows.map((r) => r.t.label)}
        series={[
          { name: 'Good passes', color: SERIES.blue, values: rows.map((r) => ratio(r.passes.filter((e) => e.value! >= 2).length, r.passes.length)), notes: rows.map((r) => `${r.passes.length} passes`) },
          { name: 'First-ball kill %', color: SERIES.aqua, values: rows.map((r) => pointPct(tally(r.fb))), notes: rows.map((r) => `${r.fb.length} attacks`) },
        ]}
        yTitle="Share" fmt={pct} yDomain={[0, 1]} />
      <More id="rotations">{fromSheet}</More>
    </div>
  );
}

/**
 * Rotations from the official match sheet: every point of every set whose service
 * rounds add up, so it covers the whole match even where nothing was tagged.
 */
function SheetRotations({ sheets, players }: { sheets: MatchSheetFlow[]; players: Player[] }) {
  const st = useMemo(() => sheetStats(sheets, players), [sheets, players]);
  if (!st.sets) return null;
  const who = (n: number) => { const p = players.find((x) => x.number === n); return p ? `#${n} ${p.name.split(' ')[0]}` : `#${n}`; };
  return (
    <>
      <h3 className="section-title">From the match sheet</h3>
      <StatFigure title="Points per rotation (match sheet)" subtitle={`Every point of ${st.sets} set${st.sets === 1 ? '' : 's'}, replayed from the service rounds on the official sheet. S1 = setter in position I.`}
        rows={st.rotations} rowKey={(r) => r.label}
        first={{ h: 'Rotation', cell: (r) => r.label }}
        columns={[
          { h: 'Side-out', cell: (r) => { const v = ratio(r.sideouts, r.received); return { text: pct(v), tone: sample(judge.sideout(v), r.received), title: `${r.sideouts}/${r.received}` }; } },
          { h: 'Break', cell: (r) => { const v = ratio(r.breaks, r.served); return { text: pct(v), tone: sample(judge.break(v), r.served), title: `${r.breaks}/${r.served}` }; } },
          { h: 'Won', title: 'Points won in this rotation', cell: (r) => r.sideouts + r.breaks },
          { h: 'Lost', title: 'Points lost in this rotation', cell: (r) => r.received - r.sideouts + r.served - r.breaks },
          { h: '+/−', cell: (r) => { const v = r.sideouts + r.breaks - (r.received - r.sideouts + r.served - r.breaks); return { text: v > 0 ? `+${v}` : String(v), tone: judge.plusMinus(v) }; } },
        ]} />
      {st.servers.length > 0 && (
        <StatFigure title="Serve turns (match sheet)" subtitle="Per server: service turns, points served and points won while serving (break points)"
          rows={st.servers} rowKey={(r) => r.number}
          first={{ h: 'Server', cell: (r) => who(r.number) }}
          columns={[
            { h: 'Turns', cell: (r) => r.turns },
            { h: 'Served', cell: (r) => r.points },
            { h: 'Won', cell: (r) => r.won },
            { h: 'Per turn', title: 'Points won per service turn', cell: (r) => (r.turns ? (r.won / r.turns).toFixed(1) : '–') },
            { h: 'Break %', cell: (r) => { const v = ratio(r.won, r.points); return { text: pct(v), tone: sample(judge.break(v), r.points) }; } },
          ]} />
      )}
    </>
  );
}
