import { useMemo, useState } from 'react';
import type { Player, VEvent } from '../../lib/api';
import { attackContexts, buildRallies } from '../../lib/sequence';
import { eff, FRONT_ROW_FROM, pointPct, tally } from '../../lib/trajectory';
import { who } from './AttackSection';
import { eff3, judge, pct, ratio, sample, StatFigure } from './ui';

/**
 * Kinds of set by where the set went (its second tap), as seen from behind our baseline
 * with the setter right of the middle: along the net from zone 4 (left) to zone 2
 * (right), or to the back row (blue left, white middle / pipe, red right).
 */
export const SET_KINDS = [
  { key: 'outside', label: 'Outside (4 / 5)', color: '#16a34a', front: true, from: 0, to: 1.5 },
  { key: 'shoot', label: 'Shoot / 32', color: '#2563eb', front: true, from: 1.5, to: 3.5 },
  { key: 'quick', label: 'Quick (1 / 31)', color: '#db2777', front: true, from: 3.5, to: 6.3 },
  { key: 'behind', label: 'Behind (A / slide)', color: '#a16207', front: true, from: 6.3, to: 7.8 },
  { key: 'right', label: 'Right side (9)', color: '#ea580c', front: true, from: 7.8, to: 9.01 },
  { key: 'blue', label: 'Back row left (blue)', color: '#1d6fb8', front: false, from: 0, to: 3 },
  { key: 'white', label: 'Pipe (white)', color: '#9ca3af', front: false, from: 3, to: 6 },
  { key: 'red', label: 'Back row right (red)', color: '#dc2626', front: false, from: 6, to: 9.01 },
] as const;
export type SetKind = (typeof SET_KINDS)[number]['key'];

export function setKind(e: Pick<VEvent, 'x' | 'y'>): SetKind | null {
  if (e.x == null || e.y == null) return null;
  const front = e.y >= FRONT_ROW_FROM;
  const x = Math.max(0, Math.min(9, e.x));
  return SET_KINDS.find((k) => k.front === front && x >= k.from && x < k.to)?.key ?? null;
}

/**
 * The setter's sets from the side, like a set chart: one arc per kind of set from the
 * setter to where it went, as thick as it is frequent, with how the attack after it went.
 * Only sets by players with the setter role (or [only], one setter).
 */
export function SetterView({ players, events, only }: { players: Player[]; events: VEvent[]; only?: number }) {
  const setters = players.filter((p) => (only == null ? p.role === 'S' : p.id === only));
  const all = events.filter((e) => e.action === 'set' && setters.some((p) => p.id === e.player_id));
  const withSpot = all.filter((e) => setKind(e) != null);
  const ids = setters.filter((p) => withSpot.some((e) => e.player_id === p.id)).map((p) => p.id);
  const [pick, setPick] = useState<number | null>(null);
  const setter = pick != null && ids.includes(pick) ? pick : ids[0];
  const attackAfter = useMemo(() => {
    const m = new Map<number, VEvent>();
    for (const c of attackContexts(buildRallies(events))) if (c.set) m.set(c.set.id, c.attack);
    return m;
  }, [events]);
  if (setter == null) return null;

  const sets = withSpot.filter((e) => e.player_id === setter);
  const total = sets.length;
  const rows = SET_KINDS.map((k) => {
    const list = sets.filter((e) => setKind(e) === k.key);
    const attacks = list.map((e) => attackAfter.get(e.id)).filter((a): a is VEvent => !!a);
    return { ...k, list, t: tally(attacks) };
  }).filter((r) => r.list.length);
  // Where the setter stands: the median of where the sets were played from, else right of the middle.
  const xs = sets.map((e) => e.fx).filter((v): v is number => v != null).sort((a, b) => a - b);
  const sx = xs.length ? Math.max(4, Math.min(8, xs[Math.floor(xs.length / 2)])) : 6;

  // Drawing: 10 units per metre, net from x = 5 to 95 at y = 52; back-row bands below it.
  const X = (m: number) => 5 + m * 10, NET = 52, FLOOR = 72;
  const max = Math.max(...rows.map((r) => r.list.length));
  const arc = (r: (typeof rows)[number]) => {
    // Lands where these sets went on average (the middle of their spots).
    const dx = r.list.map((e) => e.x!).sort((a, b) => a - b);
    const mid = dx[Math.floor(dx.length / 2)];
    const tx = X(mid), fx = X(sx);
    const ty = r.front ? NET - 4 : FLOOR + 4;
    const h = r.front ? 10 + Math.abs(mid - sx) * 3.4 : 20 + Math.abs(mid - sx) * 2;
    const cy = Math.min(NET - 4, ty) - h;
    return { d: `M ${fx} ${NET - 4} Q ${(fx + tx) / 2} ${cy * 2 - (NET - 4 + ty) / 2} ${tx} ${ty}`, tx, ty, top: cy };
  };

  return (
    <figure className="chart setter-view">
      <figcaption>
        <div className="chart-title"><b>Set chart{ids.length === 1 || only != null ? ` · ${who(players.find((p) => p.id === setter)!)}` : ''}</b></div>
        <span className="chart-sub">The setter's sets from the side, by where they went: the thicker the arc, the more often. Seen from behind our baseline, zone 4 left. {total} sets with a spot.</span>
      </figcaption>
      {ids.length > 1 && only == null && (
        <div className="chips tight">
          {ids.map((id) => <button key={id} className={`chip ${id === setter ? 'on' : ''}`} onClick={() => setPick(id)}>{who(players.find((p) => p.id === id)!)}</button>)}
        </div>
      )}
      <svg viewBox="0 12 100 72" className="setter-svg" role="img" aria-label="Sets by kind, seen from the side">
        {/* Back-row zones on the floor: blue, white, red */}
        {([[0, '#1d6fb8'], [3, '#e5e7eb'], [6, '#dc2626']] as const).map(([m, c]) => (
          <rect key={m} x={X(m)} y={FLOOR} width={30} height={8} fill={c} opacity={0.35} />
        ))}
        <line x1={X(0)} x2={X(9)} y1={FLOOR} y2={FLOOR} className="sv-line" />
        {/* The net with antennas */}
        <rect x={X(0)} y={NET} width={90} height={9} className="sv-net" />
        {Array.from({ length: 17 }, (_, k) => <line key={k} x1={X(0.5 + k * 0.5)} x2={X(0.5 + k * 0.5)} y1={NET} y2={NET + 9} className="sv-mesh" />)}
        {[3, 6].map((y) => <line key={y} x1={X(0)} x2={X(9)} y1={NET + y} y2={NET + y} className="sv-mesh" />)}
        <line x1={X(0)} x2={X(9)} y1={NET} y2={NET} className="sv-tape" />
        <line x1={X(0)} x2={X(0)} y1={NET - 8} y2={NET + 9} className="sv-antenna" />
        <line x1={X(9)} x2={X(9)} y1={NET - 8} y2={NET + 9} className="sv-antenna" />
        {[1.5, 4.5, 7.5].map((m, k) => <text key={m} x={X(m)} y={FLOOR - 1.5} className="sv-zone">zone {[4, 3, 2][k]}</text>)}
        {rows.map((r) => {
          const a = arc(r);
          const w = 0.8 + 4.2 * (r.list.length / max);
          return (
            <g key={r.key}>
              <path d={a.d} fill="none" stroke={r.color} strokeWidth={w} strokeLinecap="round" opacity={0.9}>
                <title>{`${r.label}: ${r.list.length} sets (${pct(ratio(r.list.length, total))})`}</title>
              </path>
              <circle cx={a.tx} cy={a.ty} r={1.6} fill={r.color} />
              <text x={a.tx} y={a.ty - 2.8} className="sv-label">{pct(ratio(r.list.length, total))}</text>
            </g>
          );
        })}
        {/* The setter */}
        <circle cx={X(sx)} cy={NET - 4} r={2.2} className="sv-setter" />
        <line x1={X(sx)} x2={X(sx)} y1={NET - 1.8} y2={NET + 10} className="sv-setter-pole" />
        <text x={X(sx)} y={NET + 13} className="sv-setter-label">setter</text>
      </svg>
      <div className="chart-legend">{rows.map((r) => <span key={r.key}><i style={{ background: r.color }} />{r.label}</span>)}</div>
      <StatFigure title="By kind of set" subtitle="How often, and how the attack right after it went"
        rows={rows} rowKey={(r) => r.key}
        first={{ h: 'Set', cell: (r) => r.label }}
        columns={[
          { h: 'Sets', cell: (r) => r.list.length },
          { h: 'Share', cell: (r) => pct(ratio(r.list.length, total)) },
          { h: 'K%', cell: (r) => ({ text: r.t.n ? pct(pointPct(r.t)) : '–', tone: sample(judge.killPct(pointPct(r.t)), r.t.n) }) },
          { h: 'Eff', cell: (r) => ({ text: r.t.n ? eff3(eff(r.t)) : '–', tone: sample(judge.eff(eff(r.t)), r.t.n, 3), title: `${r.t.points}-${r.t.errors}/${r.t.n} attacks` }) },
        ]}
        play={(r) => r.list} />
    </figure>
  );
}
