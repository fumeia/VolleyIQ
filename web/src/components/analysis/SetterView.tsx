import { useMemo, useState } from 'react';
import type { Player, VEvent } from '../../lib/api';
import { attackContexts, buildRallies } from '../../lib/sequence';
import { eff, FRONT_ROW_FROM, pointPct, tally } from '../../lib/trajectory';
import { who } from './AttackSection';
import { eff3, judge, pct, ratio, sample, StatFigure } from './ui';

/**
 * Where a set went (its second tap), as seen from behind our baseline with the setter
 * right of the middle: along the net from zone 4 (left) to zone 2 (right), or to the
 * back row (left, middle = pipe, right).
 */
export const SET_KINDS = [
  { key: 'outside', label: 'Left, to the antenna', color: '#16a34a', front: true, from: 0, to: 1.5 },
  { key: 'shoot', label: 'Shoot (left, inside the antenna)', color: '#2563eb', front: true, from: 1.5, to: 3.5 },
  { key: 'quick', label: 'Quick (middle, in front of the setter)', color: '#db2777', front: true, from: 3.5, to: 6.3 },
  { key: 'behind', label: 'Behind the setter', color: '#a16207', front: true, from: 6.3, to: 7.8 },
  { key: 'right', label: 'Right, to the antenna', color: '#ea580c', front: true, from: 7.8, to: 9.01 },
  { key: 'blue', label: 'Back row, left', color: '#1d6fb8', front: false, from: 0, to: 3 },
  { key: 'white', label: 'Pipe', color: '#9ca3af', front: false, from: 3, to: 6 },
  { key: 'red', label: 'Alpha', color: '#dc2626', front: false, from: 6, to: 9.01 },
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

  // Where the setter sets from on the floor (depth too): the middle of the "played from" spots.
  const ys = sets.map((e) => e.fy).filter((v): v is number => v != null).sort((a, b) => a - b);
  const sy = ys.length ? Math.max(6.5, Math.min(9, ys[Math.floor(ys.length / 2)])) : 8.3;

  // Our half in perspective, seen from behind our baseline: court metres (x across, y from our
  // baseline to the net at 9, z up) -> picture. The net is further away, so narrower.
  const P = (x: number, y: number, z = 0) => {
    const d = (9 - y) / 9; // 0 at the net, 1 at our baseline
    const k = 5.6 + 4.2 * d; // picture units per metre at this depth
    return { x: 50 + (x - 4.5) * k, y: 44 + d * 46 - z * k };
  };
  const pt = (x: number, y: number, z = 0) => { const q = P(x, y, z); return `${q.x.toFixed(2)},${q.y.toFixed(2)}`; };
  const poly = (pts: [number, number, number?][]) => pts.map(([x, y, z]) => pt(x, y, z ?? 0)).join(' ');
  const max = Math.max(...rows.map((r) => r.list.length));
  const HAND = 2.4, HIT = 2.9; // metres: where the setter plays the ball, where the hitter meets it
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const arc = (r: (typeof rows)[number]) => {
    // Lands where these sets went (the middle of their spots).
    const tx = median(r.list.map((e) => e.x!)), ty = median(r.list.map((e) => e.y!));
    const far = Math.hypot(tx - sx, ty - sy);
    // Shoot: fast and straight; quick: low and flat; the rest arcs higher the further it goes.
    const lift = r.key === 'shoot' ? 0 : r.key === 'quick' ? 0.5 + far * 0.15 : r.front ? 1.6 + far * 0.45 : 1 + far * 0.25;
    const pts: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push(pt(sx + (tx - sx) * t, sy + (ty - sy) * t, HAND + (HIT - HAND) * t + 4 * lift * t * (1 - t)));
    }
    return { d: `M ${pts.join(' L ')}`, end: P(tx, ty, HIT), floor: P(tx, ty), shadow: `M ${pt(sx, sy)} L ${pt(tx, ty)}` };
  };
  const setterAt = P(sx, sy, HAND), setterFloor = P(sx, sy);

  return (
    <figure className="chart setter-view">
      <figcaption>
        <div className="chart-title"><b>Set chart{ids.length === 1 || only != null ? ` · ${who(players.find((p) => p.id === setter)!)}` : ''}</b></div>
        <span className="chart-sub">Where the setter's sets went, on our half seen from behind our baseline (zone 4 on the left, the net at the back): the thicker the arc, the more often; the shadow on the floor shows where it went, front row or behind the 3 m line. {total} sets with a spot.</span>
      </figcaption>
      {ids.length > 1 && only == null && (
        <div className="chips tight">
          {ids.map((id) => <button key={id} className={`chip ${id === setter ? 'on' : ''}`} onClick={() => setPick(id)}>{who(players.find((p) => p.id === id)!)}</button>)}
        </div>
      )}
      <svg viewBox="0 4 100 90" className="setter-svg" role="img" aria-label="Where the sets went, in a 3D view of our half">
        {/* Our half: floor, back-row thirds (left, pipe, alpha), lines, zones */}
        <polygon points={poly([[0, 0], [9, 0], [9, 9], [0, 9]])} className="sv-floor" />
        {([[0, 'sv-back-l'], [3, 'sv-back-m'], [6, 'sv-back-r']] as const).map(([x0, c]) => (
          <polygon key={x0} points={poly([[x0, 0], [x0 + 3, 0], [x0 + 3, 6], [x0, 6]])} className={c} />
        ))}
        <polygon points={poly([[0, 0], [9, 0], [9, 9], [0, 9]])} className="sv-lines" />
        <polyline points={poly([[0, 6], [9, 6]])} className="sv-attack-line" />
        {[3, 6].map((x) => <polyline key={x} points={poly([[x, 0], [x, 9]])} className="sv-zone-line" />)}
        {[[1.5, 4], [4.5, 3], [7.5, 2]].map(([x, z]) => { const q = P(x, 7.5); return <text key={z} x={q.x} y={q.y + 1} className="sv-zone">{z}</text>; })}
        {[[1.5, 5], [4.5, 6], [7.5, 1]].map(([x, z]) => { const q = P(x, 3); return <text key={z} x={q.x} y={q.y + 1} className="sv-zone">{z}</text>; })}
        {(() => { const q = P(0.15, 6); return <text x={q.x} y={q.y - 0.8} className="sv-tag">3 m line</text>; })()}
        {/* The net and antennas */}
        <polygon points={poly([[0, 9, 0], [9, 9, 0], [9, 9, 2.43], [0, 9, 2.43]])} className="sv-net" />
        {Array.from({ length: 17 }, (_, k) => <polyline key={k} points={poly([[0.5 + k * 0.5, 9, 0.9], [0.5 + k * 0.5, 9, 2.43]])} className="sv-mesh" />)}
        <polyline points={poly([[0, 9, 0.9], [9, 9, 0.9]])} className="sv-mesh" />
        <polyline points={poly([[0, 9, 2.43], [9, 9, 2.43]])} className="sv-tape" />
        <polyline points={poly([[0, 9, 0], [0, 9, 3.3]])} className="sv-antenna" />
        <polyline points={poly([[9, 9, 0], [9, 9, 3.3]])} className="sv-antenna" />
        {/* Shadows on the floor first, then the sets */}
        {rows.map((r) => <path key={r.key} d={arc(r).shadow} className="sv-shadow" stroke={r.color} />)}
        <line x1={setterFloor.x} x2={setterAt.x} y1={setterFloor.y} y2={setterAt.y} className="sv-setter-pole" />
        {rows.map((r) => {
          const a = arc(r);
          const w = 0.6 + 3.4 * (r.list.length / max);
          return (
            <g key={r.key}>
              <line x1={a.end.x} x2={a.floor.x} y1={a.end.y} y2={a.floor.y} stroke={r.color} className="sv-drop" />
              <ellipse cx={a.floor.x} cy={a.floor.y} rx={1.6} ry={0.7} fill={r.color} opacity={0.7} />
              <path d={a.d} fill="none" stroke={r.color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" opacity={0.92}>
                <title>{`${r.label}: ${r.list.length} sets (${pct(ratio(r.list.length, total))})`}</title>
              </path>
              <circle cx={a.end.x} cy={a.end.y} r={1.3} fill={r.color} />
              <text x={a.end.x} y={a.end.y - 2.2} className="sv-label">{pct(ratio(r.list.length, total))}</text>
            </g>
          );
        })}
        {/* The setter */}
        <circle cx={setterAt.x} cy={setterAt.y} r={1.8} className="sv-setter" />
        <text x={setterAt.x + 2.6} y={setterAt.y + 0.9} className="sv-setter-label left">setter</text>
      </svg>
      <div className="chart-legend">{rows.map((r) => <span key={r.key}><i style={{ background: r.color }} />{r.label}</span>)}</div>
      <StatFigure title="Where the sets went" subtitle="How often the setter set to each spot, and how the attack right after it went (K% = kills, Eff = kills minus errors per attack)"
        rows={rows} rowKey={(r) => r.key}
        first={{ h: 'Set to', cell: (r) => r.label }}
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
