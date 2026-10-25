import { ROLES } from '../lib/actions';
import type { Match, Player, VEvent } from '../lib/api';
import { scoreBySet, statLine } from '../lib/stats';
import { longestRuns, pointSources, setsWon, type MatchReport, type PlayerRow, type TrendPoint } from './analytics';
import {
  C, Card, clip, CourtSvg, fmtAvg, fmtEff, fmtPct, GradeLegend, H, Heading, HBars, OutcomeLegend, Tile, W, type CourtDot, type Outcome,
} from './ui';

const who = (p: Player) => `#${p.number ?? '–'} ${p.name}`;
const footerFor = (rep: { title: string }) => `${rep.title} · made with VolleyIQ`;

function outcomeOf(e: VEvent): Outcome {
  if (e.action === 'kill' || e.action === 'ace') return 'point';
  if (e.action === 'block_point') return 'point';
  if (['attack_error', 'serve_error', 'attack_blocked', 'block_error', 'dig_error'].includes(e.action)) return 'error';
  return 'play';
}

/** Dots at where the ball went (x, y), or with [from] at where it was played from (fx, fy). */
const dotsFor = (events: VEvent[], actions: string[], players: Player[], from = false): CourtDot[] =>
  events.map((e) => (from ? { ...e, x: e.fx ?? null, y: e.fy ?? null } : e))
    .filter((e) => e.x != null && e.y != null && actions.includes(e.action)).map((e) => {
    const p = players.find((x) => x.id === e.player_id);
    const label = `${p ? who(p) : 'Unknown'} · ${e.action.replace('_', ' ')}`;
    return e.action === 'receive'
      ? { x: e.x!, y: e.y!, grade: e.value ?? 1, title: `${label} ${e.value ?? ''}` }
      : { x: e.x!, y: e.y!, outcome: outcomeOf(e), title: label };
  });

/* ------------------------------------------------------------------ match */

export function SummaryCard({ rep }: { rep: MatchReport }) {
  const t = rep.team;
  // Only claim a sets result when every tagged set is complete; otherwise show the set scores.
  const complete = rep.sets.length > 0 && rep.setsWon.us + rep.setsWon.them === rep.sets.length;
  const tileW = (W - 144 - 40) / 3;
  return (
    <Card kind="Match summary" title={rep.title} subtitle={rep.subtitle} footer={footerFor(rep)}>
      {complete ? (
        <>
          <text x={W / 2} y={400} fill={C.ink} fontSize={150} fontWeight={800} textAnchor="middle">{`${rep.setsWon.us} – ${rep.setsWon.them}`}</text>
          <text x={W / 2} y={460} fill={C.ink2} fontSize={32} textAnchor="middle">{rep.sets.map((s) => `${s.us}:${s.them}`).join('   ')}</text>
        </>
      ) : rep.sets.length ? (
        <>
          <text x={W / 2} y={300} fill={C.muted} fontSize={24} fontWeight={700} textAnchor="middle" letterSpacing={2}>SETS (TAGGED POINTS)</text>
          {rep.sets.map((s, i) => {
            const n = rep.sets.length;
            const step = (W - 160) / n;
            const x = W / 2 + (i - (n - 1) / 2) * step;
            // "25:23" is ~2.9 em wide: size each score to its slot so neighbours never touch.
            const size = Math.min(90, Math.floor((step * 0.85) / 2.9));
            return (
              <g key={s.set}>
                <text x={x} y={400} fill={C.ink} fontSize={size} fontWeight={800} textAnchor="middle">{`${s.us}:${s.them}`}</text>
                <text x={x} y={450} fill={C.ink2} fontSize={26} textAnchor="middle">Set {s.set}</text>
              </g>
            );
          })}
        </>
      ) : (
        <text x={W / 2} y={400} fill={C.ink} fontSize={120} fontWeight={800} textAnchor="middle">{`${t.points} pts`}</text>
      )}
      {[
        { label: 'Attack eff.', value: fmtEff(t.attackEff), sub: `${t.kills} K · ${t.attackErrors} E · ${t.attempts} TA` },
        { label: 'Kill %', value: fmtPct(t.killPct), sub: `${t.kills} kills` },
        { label: 'Serve in', value: fmtPct(t.serveInPct), sub: `${t.aces} aces · ${t.serveErrors} errors` },
        { label: 'Pass avg', value: fmtAvg(t.recAvg), sub: `${t.receptions} passes · ${fmtPct(t.recPerfectPct)} perfect` },
        { label: 'Blocks', value: String(t.blockPoints), sub: `${t.blockTouches} touches` },
        { label: 'Our errors', value: String(t.errors), sub: `${t.points} points won by us` },
      ].map((k, i) => <Tile key={k.label} x={72 + (i % 3) * (tileW + 20)} y={520 + Math.floor(i / 3) * 170} w={tileW} {...k} />)}
      <Heading x={72} y={900}>Top performers</Heading>
      {rep.leaders.slice(0, 6).map((l, i) => (
        <g key={l.label}>
          <text x={72} y={958 + i * 56} fill={C.muted} fontSize={28}>{l.label}</text>
          <text x={340} y={958 + i * 56} fill={C.ink} fontSize={30} fontWeight={700}>{clip(who(l.player), 24)}</text>
          <text x={W - 72} y={958 + i * 56} fill={C.ink} fontSize={30} textAnchor="end">{l.value}</text>
        </g>
      ))}
      {!rep.leaders.length && <text x={72} y={958} fill={C.muted} fontSize={28}>Tag a few actions to see leaders.</text>}
    </Card>
  );
}

export function FlowCard({ rep }: { rep: MatchReport }) {
  const sets = rep.flow.slice(0, 5);
  const top = 300;
  const slot = (H - top - 120) / Math.max(1, sets.length);
  const panelH = Math.min(300, slot - 70);
  const x0 = 120, x1 = W - 150;
  return (
    <Card kind="Score flow" title={rep.title} subtitle="Running score per set" footer={footerFor(rep)}>
      <g transform="translate(72,276)">
        <line x1={0} x2={40} y1={-8} y2={-8} stroke={C.blue} strokeWidth={5} />
        <text x={52} y={0} fill={C.ink2} fontSize={26}>Us</text>
        <line x1={140} x2={180} y1={-8} y2={-8} stroke={C.orange} strokeWidth={5} />
        <text x={192} y={0} fill={C.ink2} fontSize={26}>Opponent</text>
      </g>
      {sets.map((s, k) => {
        const y0 = top + k * slot + 56;
        const last = s.points[s.points.length - 1];
        const maxY = Math.max(25, last.us, last.them);
        const maxX = Math.max(1, last.i);
        const px = (i: number) => x0 + (i / maxX) * (x1 - x0);
        const py = (v: number) => y0 + panelH - (v / maxY) * panelH;
        const line = (key: 'us' | 'them') => s.points.map((p, j) => `${j ? 'L' : 'M'}${px(p.i).toFixed(1)},${py(p[key]).toFixed(1)}`).join('');
        const runs = longestRuns(s.points);
        return (
          <g key={s.set}>
            <text x={72} y={y0 - 16} fill={C.ink} fontSize={30} fontWeight={800}>Set {s.set}</text>
            <text x={210} y={y0 - 16} fill={C.muted} fontSize={24}>{`${last.us}:${last.them} · longest run: us ${runs.us}, them ${runs.them}`}</text>
            {(panelH < 160 ? [10, 20] : [5, 10, 15, 20, 25]).filter((g) => g <= maxY).map((g) => (
              <g key={g}>
                <line x1={x0} x2={x1} y1={py(g)} y2={py(g)} stroke={C.grid} strokeWidth={2} />
                <text x={x0 - 12} y={py(g) + 8} fill={C.muted} fontSize={20} textAnchor="end">{g}</text>
              </g>
            ))}
            <line x1={x0} x2={x1} y1={py(0)} y2={py(0)} stroke={C.axis} strokeWidth={2} />
            {Array.from({ length: Math.floor(maxX / 10) + 1 }, (_, j) => j * 10).map((r) => (
              <text key={r} x={px(r)} y={py(0) + 26} fill={C.muted} fontSize={18} textAnchor="middle">{r}</text>
            ))}
            {k === sets.length - 1 && <text x={x1} y={py(0) + 52} fill={C.muted} fontSize={20} textAnchor="end">rally →</text>}
            <path d={line('them')} fill="none" stroke={C.orange} strokeWidth={5} strokeLinejoin="round" />
            <path d={line('us')} fill="none" stroke={C.blue} strokeWidth={5} strokeLinejoin="round" />
            <text x={x1 + 16} y={py(last.us) + (last.us >= last.them ? -4 : 26)} fill={C.ink} fontSize={30} fontWeight={800}>{last.us}</text>
            <text x={x1 + 16} y={py(last.them) + (last.them > last.us ? -4 : 26)} fill={C.ink2} fontSize={30} fontWeight={700}>{last.them}</text>
          </g>
        );
      })}
      {!sets.length && <text x={72} y={360} fill={C.muted} fontSize={30}>No points tagged yet (kills, aces, errors, opponent points).</text>}
    </Card>
  );
}

export function PointsCard({ rep }: { rep: MatchReport }) {
  const won = rep.sources.won;
  const lost = rep.sources.lost;
  const sum = (b: { value: number }[]) => b.reduce((a, x) => a + x.value, 0);
  return (
    <Card kind="Points" title={rep.title} subtitle="Where our points came from, and where we gave them away" footer={footerFor(rep)}>
      <Heading x={72} y={320}>{`How we scored · ${sum(won)}`}</Heading>
      <HBars x={72} y={340} w={W - 144} rows={won} color={C.aqua} rowH={76} />
      <Heading x={72} y={720}>{`How the opponent scored · ${sum(lost)}`}</Heading>
      <HBars x={72} y={740} w={W - 144} rows={lost} color={C.orange} rowH={76} />
    </Card>
  );
}

export function AttackCard({ rep, players }: { rep: MatchReport; players: Player[] }) {
  const dots = dotsFor(rep.confirmed, ['kill', 'attack', 'attack_error'], players);
  const t = rep.team;
  return (
    <Card kind="Attack" title={rep.title} subtitle={`${t.kills} kills · ${t.attackErrors} errors · ${t.attempts} attempts · eff. ${fmtEff(t.attackEff)}`} footer={footerFor(rep)}>
      <OutcomeLegend x={72} y={300} labels={['Kill', 'In play', 'Error']} />
      <CourtSvg x={(W - 13 * 60) / 2} y={330} scale={60} half="theirs" dots={dots} zoneLabels />
      <Heading x={72} y={1110}>Kill % by target zone</Heading>
      {rep.zones.map((z, i) => {
        const x = 72 + i * ((W - 144) / 6);
        return (
          <g key={z.zone}>
            <text x={x} y={1170} fill={C.muted} fontSize={24}>Zone {z.zone}</text>
            <text x={x} y={1218} fill={C.ink} fontSize={38} fontWeight={800}>{z.attempts ? fmtPct(z.kills / z.attempts) : '–'}</text>
            <text x={x} y={1252} fill={C.ink2} fontSize={22}>{z.kills}/{z.attempts}</text>
          </g>
        );
      })}
    </Card>
  );
}

export function ServeCard({ rep, players }: { rep: MatchReport; players: Player[] }) {
  const dots = dotsFor(rep.confirmed, ['ace', 'serve', 'serve_error'], players);
  const servers = rep.rows.filter((r) => r.stats.serves > 0).sort((a, b) => b.stats.serves - a.stats.serves).slice(0, 6);
  const t = rep.team;
  return (
    <Card kind="Serve" title={rep.title} subtitle={`${t.serves} serves · ${t.aces} aces · ${t.serveErrors} errors · ${fmtPct(t.serveInPct)} in`} footer={footerFor(rep)}>
      <OutcomeLegend x={72} y={300} labels={['Ace', 'In play', 'Error']} />
      <CourtSvg x={(W - 13 * 46) / 2} y={325} scale={46} half="theirs" dots={dots} />
      <ServerTable y={940} rows={servers} />
    </Card>
  );
}

/** Blocks and digs: where along the net we block and get blocked, and where we dig. */
export function NetDefenceCard({ rep, players }: { rep: MatchReport; players: Player[] }) {
  const blocks = dotsFor(rep.confirmed, ['block_point', 'block_touch', 'block_error'], players);
  const blocked = dotsFor(rep.confirmed, ['attack_blocked'], players);
  const digs = dotsFor(rep.confirmed, ['dig', 'dig_error'], players, true);
  const t = rep.team;
  const s = 34;
  return (
    <Card kind="Net & defence" title={rep.title} subtitle={`${t.blockPoints} block points · ${t.blockTouches} touches · ${t.blocked} times blocked · ${t.digs} digs`} footer={footerFor(rep)}>
      <OutcomeLegend x={72} y={300} labels={['Point', 'In play', 'Error']} />
      <Heading x={72} y={370}>{`Our blocks · ${blocks.length}`}</Heading>
      <CourtSvg x={72} y={385} scale={s} half="ours" dots={blocks} zoneLabels />
      <Heading x={W - 72 - 13 * s} y={370}>{`We got blocked · ${blocked.length}`}</Heading>
      <CourtSvg x={W - 72 - 13 * s} y={385} scale={s} half="ours" dots={blocked} zoneLabels />
      <Heading x={72} y={880}>{`Digs · ${t.digs} · errors ${t.digErrors}`}</Heading>
      <CourtSvg x={(W - 13 * 28) / 2} y={895} scale={28} half="ours" dots={digs} zoneLabels />
    </Card>
  );
}

function ServerTable({ y, rows }: { y: number; rows: PlayerRow[] }) {
  const cols = [['Serves', (r: PlayerRow) => String(r.stats.serves)], ['Aces', (r: PlayerRow) => String(r.stats.aces)],
    ['Errors', (r: PlayerRow) => String(r.stats.serveErrors)], ['In %', (r: PlayerRow) => fmtPct(r.stats.serveInPct)]] as const;
  return (
    <g>
      {cols.map(([h], i) => <text key={h} x={560 + i * 128} y={y} fill={C.muted} fontSize={22} textAnchor="end" fontWeight={700}>{h.toUpperCase()}</text>)}
      {rows.map((r, k) => (
        <g key={r.player.id}>
          <text x={72} y={y + 50 + k * 50} fill={C.ink} fontSize={28}>{clip(who(r.player), 20)}</text>
          {cols.map(([h, f], i) => <text key={h} x={560 + i * 128} y={y + 50 + k * 50} fill={C.ink} fontSize={28} textAnchor="end">{f(r)}</text>)}
        </g>
      ))}
    </g>
  );
}

export function ReceptionCard({ rep, players }: { rep: MatchReport; players: Player[] }) {
  const dots = dotsFor(rep.confirmed, ['receive'], players);
  const rows = rep.receivers.slice(0, 6);
  const t = rep.team;
  const barX = 400, barW = W - barX - 250;
  return (
    <Card kind="Reception" title={rep.title} subtitle={`${t.receptions} passes · avg ${fmtAvg(t.recAvg)} · ${fmtPct(t.recPerfectPct)} perfect`} footer={footerFor(rep)}>
      <GradeLegend x={72} y={300} />
      <CourtSvg x={(W - 13 * 46) / 2} y={325} scale={46} half="ours" dots={dots} target />
      <Heading x={72} y={940}>Passes by grade</Heading>
      {rows.map((r, k) => {
        const n = r.grades.reduce((a, b) => a + b, 0);
        let acc = 0;
        const y = 980 + k * 50;
        return (
          <g key={r.player.id}>
            <text x={72} y={y + 24} fill={C.ink} fontSize={28}>{clip(who(r.player), 20)}</text>
            {r.grades.map((g, gi) => {
              if (!g) return null;
              const w = (g / n) * barW;
              const x = barX + acc;
              acc += w;
              return (
                <g key={gi}>
                  <title>{`grade ${gi}: ${g}`}</title>
                  <rect x={x + 1} y={y} width={Math.max(2, w - 2)} height={32} rx={4} fill={C.grade[gi]} />
                </g>
              );
            })}
            <text x={W - 72} y={y + 26} fill={C.ink} fontSize={28} fontWeight={700} textAnchor="end">{fmtAvg(r.avg)} · {n}</text>
          </g>
        );
      })}
    </Card>
  );
}

export function BoxScoreCard({ rep, title, subtitle }: { rep: { rows: PlayerRow[]; title: string }; title?: string; subtitle?: string }) {
  const rows = rep.rows.slice(0, 15);
  const cols: [string, (r: PlayerRow) => string][] = [
    ['Pts', (r) => String(r.stats.points)],
    ['K-E/TA', (r) => (r.stats.attempts ? `${r.stats.kills}-${r.stats.attackErrors}/${r.stats.attempts}` : '–')],
    ['Eff', (r) => fmtEff(r.stats.attackEff)],
    ['A-SE', (r) => (r.stats.serves ? `${r.stats.aces}-${r.stats.serveErrors}` : '–')],
    ['Pass', (r) => (r.stats.receptions ? fmtAvg(r.stats.recAvg) : '–')],
    ['Dig', (r) => String(r.stats.digs)],
    ['Blk', (r) => String(r.stats.blockPoints)],
  ];
  const colX = [460, 600, 690, 780, 860, 935, 1008];
  return (
    <Card kind="Box score" title={title ?? rep.title} subtitle={subtitle ?? 'Every player, one line'} footer={footerFor(rep)}>
      {cols.map(([h], i) => <text key={h} x={colX[i]} y={310} fill={C.muted} fontSize={22} fontWeight={700} textAnchor="end">{h.toUpperCase()}</text>)}
      <line x1={72} x2={W - 72} y1={330} y2={330} stroke={C.axis} strokeWidth={2} />
      {rows.map((r, k) => {
        const y = 380 + k * 58;
        return (
          <g key={r.player.id}>
            {k % 2 === 1 && <rect x={60} y={y - 38} width={W - 120} height={58} rx={10} fill={C.page} />}
            <text x={72} y={y} fill={C.ink} fontSize={28} fontWeight={600}>{clip(who(r.player), 20)}</text>
            {cols.map(([h, f], i) => (
              <text key={h} x={colX[i]} y={y} fill={i === 0 ? C.ink : C.ink2} fontSize={28} fontWeight={i === 0 ? 800 : 400} textAnchor="end">{f(r)}</text>
            ))}
          </g>
        );
      })}
      {!rows.length && <text x={72} y={400} fill={C.muted} fontSize={28}>No player tags yet.</text>}
      <text x={72} y={H - 100} fill={C.muted} fontSize={20}>K kills · E errors · TA attempts · Eff (K−E)/TA · A aces · SE serve errors · Pass avg 0–3 · Blk block points</text>
    </Card>
  );
}

export function PlayerCard({ row, events, players, context }: { row: PlayerRow; events: VEvent[]; players: Player[]; context: string }) {
  const s = row.stats;
  const p = row.player;
  const mine = events.filter((e) => e.player_id === p.id);
  const attackDots = dotsFor(mine, ['kill', 'attack', 'attack_error'], players);
  const passDots = dotsFor(mine, ['receive'], players);
  const showPass = passDots.length > attackDots.length;
  const role = ROLES.find((r) => r.code === p.role)?.label ?? p.role;
  const tileW = (W - 144 - 40) / 3;
  return (
    <Card kind="Player" title={p.name} subtitle={`${role} · ${context}`} footer={`#${p.number ?? '–'} ${p.name} · made with VolleyIQ`}>
      <circle cx={W - 140} cy={196} r={60} fill={C.page} stroke={C.brand} strokeWidth={5} />
      <text x={W - 140} y={218} fill={C.ink} fontSize={62} fontWeight={800} textAnchor="middle">{p.number ?? '–'}</text>
      {[
        { label: 'Points', value: String(s.points), sub: `${s.kills} K · ${s.aces} A · ${s.blockPoints} B` },
        { label: 'Attack eff.', value: fmtEff(s.attackEff), sub: `${s.kills}-${s.attackErrors} / ${s.attempts} TA` },
        { label: 'Serve', value: fmtPct(s.serveInPct), sub: `${s.serves} serves · ${s.aces} aces` },
        { label: 'Pass avg', value: fmtAvg(s.recAvg), sub: `${s.receptions} passes` },
        { label: 'Defense', value: String(s.digs), sub: `digs · ${s.digErrors} errors` },
        p.role === 'S'
          ? { label: 'Setting', value: String(s.assists), sub: `assists · ${s.assistErrors} errors` }
          : { label: 'Block', value: String(s.blockPoints), sub: `points · ${s.blockTouches} touches` },
      ].map((k, i) => <Tile key={k.label} x={72 + (i % 3) * (tileW + 20)} y={280 + Math.floor(i / 3) * 170} w={tileW} {...k} />)}
      {showPass ? (
        <>
          <Heading x={72} y={650}>Where the passes went</Heading>
          <GradeLegend x={500} y={650} />
          <CourtSvg x={(W - 13 * 46) / 2} y={680} scale={46} half="ours" dots={passDots} target />
        </>
      ) : attackDots.length ? (
        <>
          <Heading x={72} y={650}>Where the attacks went</Heading>
          <OutcomeLegend x={72} y={700} labels={['Kill', 'In play', 'Error']} />
          <CourtSvg x={(W - 13 * 46) / 2} y={720} scale={46} half="theirs" dots={attackDots} />
        </>
      ) : (
        <text x={72} y={700} fill={C.muted} fontSize={28}>Tag attacks or passes with a court spot to see them here.</text>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ season */

export function SeasonSummaryCard({ title, matches, events, rows }: {
  title: string; matches: Pick<Match, 'id' | 'label' | 'opponent' | 'played_on'>[]; events: VEvent[]; rows: PlayerRow[];
}) {
  const t = statLine(events.filter((e) => e.player_id != null));
  const tileW = (W - 144 - 40) / 3;
  const list = matches.slice(-5).reverse();
  const won = pointSources(events).won;
  return (
    <Card kind="Season" title={title} subtitle={`${matches.length} matches · ${rows.length} players tagged`} footer={`${title} · made with VolleyIQ`}>
      {[
        { label: 'Attack eff.', value: fmtEff(t.attackEff), sub: `${t.kills} K · ${t.attackErrors} E · ${t.attempts} TA` },
        { label: 'Serve in', value: fmtPct(t.serveInPct), sub: `${t.aces} aces · ${t.serveErrors} errors` },
        { label: 'Pass avg', value: fmtAvg(t.recAvg), sub: `${t.receptions} passes` },
      ].map((k, i) => <Tile key={k.label} x={72 + i * (tileW + 20)} y={280} w={tileW} {...k} />)}
      <Heading x={72} y={520}>Recent matches</Heading>
      {list.map((m, k) => {
        const mine = events.filter((e) => e.match_id === m.id);
        const s = statLine(mine.filter((e) => e.player_id != null));
        const sets = scoreBySet(mine);
        const res = setsWon(sets);
        const complete = sets.length > 0 && res.us + res.them === sets.length;
        const y = 580 + k * 84;
        return (
          <g key={m.id}>
            <text x={72} y={y} fill={C.ink} fontSize={30} fontWeight={600}>{clip(m.opponent ? `vs ${m.opponent}` : m.label, 20)}</text>
            <text x={72} y={y + 32} fill={C.muted} fontSize={22}>{m.played_on ?? ''}</text>
            {complete && <text x={500} y={y + 4} fill={C.ink} fontSize={34} fontWeight={800} textAnchor="middle">{res.us}–{res.them}</text>}
            <text x={W - 72} y={y} fill={C.ink2} fontSize={24} textAnchor="end">eff {fmtEff(s.attackEff)} · pass {fmtAvg(s.recAvg)}</text>
            <text x={W - 72} y={y + 32} fill={C.muted} fontSize={22} textAnchor="end">{s.points} points · {s.errors} errors</text>
          </g>
        );
      })}
      <Heading x={72} y={1010}>{`How we scored · ${won.reduce((a, b) => a + b.value, 0)}`}</Heading>
      <HBars x={72} y={1024} w={W - 144} rows={won} color={C.aqua} rowH={56} />
    </Card>
  );
}

/** Small multiples: one metric per panel, each with its own axis (never two scales on one plot). */
export function TrendsCard({ title, panels }: { title: string; panels: { label: string; fmt: (v: number | null) => string; points: TrendPoint[]; domain?: [number, number] }[] }) {
  const top = 280, panelH = 200, gap = 50, x0 = 150, x1 = W - 120;
  return (
    <Card kind="Trends" title={title} subtitle="Match by match, oldest to newest" footer={`${title} · made with VolleyIQ`}>
      {panels.map((pn, k) => {
        const y0 = top + k * (panelH + gap);
        const vals = pn.points.map((p) => p.value).filter((v): v is number => v != null);
        // Zoom to the data (a trend chart need not start at zero), with a minimum visible range.
        const span = Math.max(...vals) - Math.min(...vals);
        const pad = Math.max(span * 0.15, Math.abs(Math.max(...vals, 0.1)) * 0.1);
        const [dLo, dHi] = pn.domain ?? [-Infinity, Infinity];
        const lo = vals.length ? Math.max(dLo, Math.min(...vals) - pad) : 0, hi = vals.length ? Math.min(dHi, Math.max(...vals) + pad) : 1;
        const px = (i: number) => (pn.points.length < 2 ? (x0 + x1) / 2 : x0 + (i / (pn.points.length - 1)) * (x1 - x0));
        const py = (v: number) => y0 + 40 + (panelH - 50) * (1 - (v - lo) / (hi - lo));
        const pts = pn.points.map((p, i) => (p.value == null ? null : { x: px(i), y: py(p.value), v: p.value, label: p.label })).filter((p): p is { x: number; y: number; v: number; label: string } => !!p);
        const last = pts[pts.length - 1];
        return (
          <g key={pn.label}>
            <text x={72} y={y0 + 20} fill={C.ink} fontSize={28} fontWeight={800}>{pn.label}</text>
            <line x1={x0} x2={x1} y1={py(lo)} y2={py(lo)} stroke={C.axis} strokeWidth={2} />
            <line x1={x0} x2={x1} y1={py(hi)} y2={py(hi)} stroke={C.grid} strokeWidth={2} />
            <text x={x0 - 12} y={py(hi) + 8} fill={C.muted} fontSize={20} textAnchor="end">{pn.fmt(hi)}</text>
            <text x={x0 - 12} y={py(lo) + 8} fill={C.muted} fontSize={20} textAnchor="end">{pn.fmt(lo)}</text>
            {pts.length > 1 && <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('')} fill="none" stroke={C.blue} strokeWidth={5} strokeLinejoin="round" />}
            {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={8} fill={C.blue} stroke={C.surface} strokeWidth={3}><title>{`${p.label}: ${pn.fmt(p.v)}`}</title></circle>)}
            {last && <text x={Math.min(last.x + 14, x1 + 10)} y={last.y - 14} fill={C.ink} fontSize={28} fontWeight={800}>{pn.fmt(last.v)}</text>}
            {!pts.length && <text x={x0} y={y0 + 110} fill={C.muted} fontSize={24}>not enough data</text>}
            {k === panels.length - 1 && pn.points.length > 0 && [0, pn.points.length - 1].filter((i, j, a) => a.indexOf(i) === j).map((i) => (
              <text key={i} x={px(i)} y={y0 + panelH + 30} fill={C.muted} fontSize={22} textAnchor={i === 0 && pn.points.length > 1 ? 'start' : 'end'}>{clip(pn.points[i].label, 20)}</text>
            ))}
          </g>
        );
      })}
    </Card>
  );
}

export function LeaderboardCard({ title, rows }: { title: string; rows: PlayerRow[] }) {
  const boards: [string, (r: PlayerRow) => number | null, (r: PlayerRow) => string, (r: PlayerRow) => boolean][] = [
    ['Points', (r) => r.stats.points, (r) => String(r.stats.points), () => true],
    ['Kills', (r) => r.stats.kills, (r) => String(r.stats.kills), () => true],
    ['Attack eff.', (r) => r.stats.attackEff, (r) => fmtEff(r.stats.attackEff), (r) => r.stats.attempts >= 10],
    ['Aces', (r) => r.stats.aces, (r) => String(r.stats.aces), () => true],
    ['Pass avg', (r) => r.stats.recAvg, (r) => fmtAvg(r.stats.recAvg), (r) => r.stats.receptions >= 10],
    ['Digs', (r) => r.stats.digs, (r) => String(r.stats.digs), () => true],
  ];
  const colW = (W - 144 - 40) / 2;
  return (
    <Card kind="Leaderboard" title={title} subtitle="Top 3 per category (ratios need 10+ attempts)" footer={`${title} · made with VolleyIQ`}>
      {boards.map(([label, score, fmt, ok], k) => {
        const x = 72 + (k % 2) * (colW + 40);
        const y = 300 + Math.floor(k / 2) * 300;
        const top3 = rows.filter((r) => ok(r) && (score(r) ?? 0) > 0).sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0)).slice(0, 3);
        return (
          <g key={label}>
            <rect x={x} y={y} width={colW} height={270} rx={20} fill={C.page} />
            <text x={x + 24} y={y + 46} fill={C.muted} fontSize={24} fontWeight={700} letterSpacing={2}>{label.toUpperCase()}</text>
            {top3.map((r, i) => (
              <g key={r.player.id}>
                <text x={x + 24} y={y + 104 + i * 56} fill={i === 0 ? C.ink : C.ink2} fontSize={i === 0 ? 32 : 28} fontWeight={i === 0 ? 800 : 500}>{clip(who(r.player), 18)}</text>
                <text x={x + colW - 24} y={y + 104 + i * 56} fill={C.ink} fontSize={i === 0 ? 32 : 28} fontWeight={700} textAnchor="end">{fmt(r)}</text>
              </g>
            ))}
            {!top3.length && <text x={x + 24} y={y + 110} fill={C.muted} fontSize={24}>not enough data</text>}
          </g>
        );
      })}
    </Card>
  );
}
