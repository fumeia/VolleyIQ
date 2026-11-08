import { More } from './More';
import { useMemo } from 'react';
import type { Player, VEvent } from '../../lib/api';
import { buildRallies, contactQuality, transitionConversion, transitionPossessions, type Rally } from '../../lib/sequence';
import { ourZone, targetDistance } from '../../lib/trajectory';
import { who } from './AttackSection';
import { BLOCKS, NetBlocks, NoTouchBlocks, BlockLandings } from './BlockSection';
import { avg2, diverge, HalfZones, judge, meters, pct, ratio, StatFigure, Swatch, type ZoneValue, sample } from './ui';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const DEF = ['dig', 'dig_error', 'freeball'];

/** After a dig/free ball/block touch: did our possession end in a kill, an error, or neither. */
function followUps(rallies: Rally[]) {
  const out = new Map<number, 'kill' | 'error' | 'none'>();
  for (const p of transitionPossessions(rallies)) {
    // Credit the block touch and the dig that kept it alive.
    for (const e of p.touches) if (['dig', 'freeball', 'block_touch'].includes(e.action)) out.set(e.id, p.result);
  }
  return out;
}

/** Defence: who digs, how well (where the dig went), what we make of it, and blocking. */
export function DefenseSection({ players, events }: { players: Player[]; events: VEvent[] }) {
  const rallies = useMemo(() => buildRallies(events), [events]);
  const follow = useMemo(() => followUps(rallies), [rallies]);
  const team = useMemo(() => transitionConversion(rallies), [rallies]);
  const defs = events.filter((e) => DEF.includes(e.action));
  const blocks = events.filter((e) => BLOCKS.includes(e.action));
  if (!defs.length && !blocks.length) return <p className="muted small">No digs or blocks tagged yet.</p>;

  const diggers = players.map((p) => ({ p, list: defs.filter((e) => e.player_id === p.id) })).filter((r) => r.list.length).sort((a, b) => b.list.length - a.list.length);
  const blockers = players.map((p) => ({ p, list: blocks.filter((e) => e.player_id === p.id) })).filter((r) => r.list.length).sort((a, b) => b.list.length - a.list.length);

  const zoneValues = new Map<number, ZoneValue>();
  for (const z of [4, 3, 2, 5, 6, 1]) {
    const list = defs.filter((e) => e.action !== 'freeball' && ourZone(e) === z);
    if (!list.length) continue;
    const kept = list.filter((e) => e.action === 'dig').length;
    const v = kept / list.length;
    zoneValues.set(z, { fill: diverge(v, 0.75, 0.25), main: pct(v), sub: `${kept}/${list.length} kept`, title: `Zone ${z}: ${list.length} digs, ${list.length - kept} errors` });
  }

  return (
    <div className="charts">
      <div className="kpis">
        <div className="kpi"><span className="kpi-label">Digs kept in play</span>
          <span className="kpi-value">{pct(ratio(defs.filter((e) => e.action === 'dig').length, defs.filter((e) => e.action !== 'freeball').length))}</span>
          <span className="kpi-sub">{defs.filter((e) => e.action === 'dig').length} digs · {defs.filter((e) => e.action === 'dig_error').length} errors</span></div>
        <div className="kpi"><span className="kpi-label">Transition kill %</span>
          <span className={`kpi-value tone-${judge.conversion(team.killPct) ?? 'none'}`}>{pct(team.killPct)}</span>
          <span className="kpi-sub">{team.kills} kills from {team.n} digs / free balls</span></div>
      </div>

      <StatFigure title="Defenders" subtitle="Dig quality 0–3 from where the dig went (like a pass grade). Kill after = share of their digs that we turned into a kill."
        rows={diggers} rowKey={(r) => r.p.id}
        first={{ h: 'Player', cell: (r) => who(r.p) }}
        columns={[
          { h: 'Digs', cell: (r) => r.list.filter((e) => e.action === 'dig').length },
          { h: 'Err', cell: (r) => { const n = r.list.filter((e) => e.action === 'dig_error').length; return { text: n, tone: judge.errors(n, r.list.length) }; } },
          { h: 'FB', title: 'Free balls played', cell: (r) => r.list.filter((e) => e.action === 'freeball').length },
          { h: 'Quality', cell: (r) => {
            const q = mean(r.list.filter((e) => e.action === 'dig').map(contactQuality).filter((v): v is number => v != null));
            return { text: avg2(q, 1), tone: sample(judge.passAvg(q), r.list.length) };
          } },
          { h: 'To target', cell: (r) => { const d = mean(r.list.filter((e) => e.action === 'dig').map(targetDistance).filter((v): v is number => v != null)); return { text: meters(d), tone: sample(judge.distance(d), r.list.length) }; } },
          { h: 'Kill after', cell: (r) => {
            const fs = r.list.filter((e) => follow.has(e.id)).map((e) => follow.get(e.id)!);
            const v = ratio(fs.filter((x) => x === 'kill').length, fs.length);
            return { text: pct(v), tone: sample(judge.conversion(v), fs.length), title: `${fs.length} possessions` };
          } },
        ]}
        play={(r) => r.list.filter((e) => e.action === 'dig_error')} playLabel="Errors" />

      {blockers.length > 0 && (
        <StatFigure title="Blockers" subtitle="Block points end the rally; touches slow the ball down for our defence; no touch = jumped, the ball went past"
          rows={blockers} rowKey={(r) => r.p.id}
          first={{ h: 'Player', cell: (r) => who(r.p) }}
          columns={[
            { h: 'Points', cell: (r) => { const n = r.list.filter((e) => e.action === 'block_point').length; return { text: n, tone: n > 0 ? 'good' : null }; } },
            { h: 'Touches', cell: (r) => r.list.filter((e) => e.action === 'block_touch').length },
            { h: 'Errors', title: 'Net touches / blocked out', cell: (r) => { const n = r.list.filter((e) => e.action === 'block_error').length; return { text: n, tone: n > 0 && n >= r.list.filter((e) => e.action === 'block_point').length ? 'bad' : null }; } },
            { h: 'No touch', title: 'Jumped to block, the ball went past without a touch', cell: (r) => r.list.filter((e) => e.action === 'block_miss').length },
            { h: 'Kill after', title: 'Block touches we turned into a kill', cell: (r) => {
              const fs = r.list.filter((e) => follow.has(e.id)).map((e) => follow.get(e.id)!);
              return fs.length ? pct(ratio(fs.filter((x) => x === 'kill').length, fs.length)) : '–';
            } },
          ]} />
      )}
      <NetBlocks players={players} events={events} />
      <NoTouchBlocks players={players} events={events} />
      <More id="defense">
      <HalfZones title="Digs kept by zone" subtitle="Share of digs kept in play per zone of our court (where the ball was dug)"
        half="ours" values={zoneValues}
        legend={<><Swatch fill={diverge(1, 0.75, 0.25)} label="All kept" /><Swatch fill={diverge(0.75, 0.75, 0.25)} label="75%" /><Swatch fill={diverge(0.4, 0.75, 0.25)} label="Many lost" /></>} />

      <BlockLandings players={players} events={events} />
      </More>
    </div>
  );
}
