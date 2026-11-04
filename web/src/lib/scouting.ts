import type { Match, Player, VEvent } from './api';
import { isOffBlock, isTip } from './actions';
import { breakPct, receptionZones, rotationStats, sideOutPct, type RotationRow, type ZoneRow } from './analysis';
import { pointSources } from '../report/analytics';
import { attackContexts, ATTACKS, buildRallies } from './sequence';
import { statLine, type StatLine } from './stats';
import { attackOrigin, direction, theirZone, type Direction, type Origin } from './trajectory';
import type { Lineups } from './rotation';
import { servePlan, type ServePlan } from './serveTargets';

/**
 * A scouting report on a team from its tagged matches (tagged as that team, e.g. from the
 * match centre): who to serve at, who their hitters are and where they hit, where the setter
 * goes with a good and a bad pass, how they serve, their weakest rotations, and how they win
 * and lose points. Each line says how many touches it rests on; thin data says nothing.
 */

export const MIN = { receiver: 6, attacker: 6, server: 6, setterSplit: 8, rotation: 5 };

export interface AttackerRow {
  player: Player; attempts: number; share: number; kills: number; errors: number;
  /** Tips / feints among the attempts, and kills off our block. */
  tips: number; offBlock: number;
  killPct: number; eff: number;
  /** Where they hit from (front 4/3/2, back row), most first. */
  origins: { key: Origin; n: number }[];
  /** Directions of the attacks with both spots tapped. */
  dirs: Record<Direction, number>;
}
export interface ReceiverRow { player: Player; n: number; avg: number; good: number; bad: number; errors: number }
export interface ServerRow { player: Player; n: number; aces: number; errors: number; targets: { zone: number; n: number }[] }
/** Where sets went (front 4/3/2 or the back row) after a pass or dig of this quality. */
export interface Distribution { n: number; to: Record<'4' | '3' | '2' | 'back', number> }

export interface ScoutingReport {
  matches: number; sets: number; rallies: number;
  team: StatLine;
  receivers: ReceiverRow[];
  receiveZones: ZoneRow[];
  attackers: AttackerRow[];
  setter: { good: Distribution; bad: Distribution };
  servers: ServerRow[];
  rotations: RotationRow[] | null;
  points: ReturnType<typeof pointSources>;
  /** Where to serve: side-out chance per zone and receiver. */
  serve: ServePlan;
  /** "How to play them": the strongest few takeaways, in plain words. */
  plan: string[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const name = (p: Player) => `#${p.number ?? '?'}${p.name && !/^#?\d+$/.test(p.name.trim()) ? ` ${p.name.split(' ')[0]}` : ''}`;
const front = (o: Origin | null): keyof Distribution['to'] | null => (o == null ? null : o.startsWith('b') ? 'back' : (o as '4' | '3' | '2'));
const ORIGIN_WORD: Record<Origin, string> = { '4': 'zone 4', '3': 'the middle', '2': 'zone 2', b5: 'the back row (5)', b6: 'the pipe', b1: 'the back row (1)' };

export function scoutingReport(players: Player[], events: VEvent[], matches: Pick<Match, 'id' | 'lineups'>[]): ScoutingReport {
  const ev = events.filter((e) => e.status === 'confirmed');
  const byId = new Map(players.map((p) => [p.id, p]));
  const team = statLine(ev.filter((e) => e.player_id != null));
  const rallies = buildRallies(ev);
  const sets = new Set(ev.map((e) => `${e.match_id}:${e.set_no ?? 1}`)).size;

  // Reception: who passes worst.
  const recv = new Map<number, ReceiverRow>();
  for (const e of ev) {
    if (e.action !== 'receive' || e.value == null || e.player_id == null || !byId.has(e.player_id)) continue;
    const r = recv.get(e.player_id) ?? { player: byId.get(e.player_id)!, n: 0, avg: 0, good: 0, bad: 0, errors: 0 };
    r.n++; r.avg += e.value;
    if (e.value >= 2) r.good++; else r.bad++;
    if (e.value === 0) r.errors++;
    recv.set(e.player_id, r);
  }
  const receivers = [...recv.values()].map((r) => ({ ...r, avg: r.avg / r.n })).sort((a, b) => a.avg - b.avg);

  // Attackers: share, efficiency, where from, which direction.
  const attacks = ev.filter((e) => ATTACKS.includes(e.action) && e.player_id != null && byId.has(e.player_id));
  const att = new Map<number, AttackerRow>();
  for (const e of attacks) {
    const r = att.get(e.player_id!) ?? { player: byId.get(e.player_id!)!, attempts: 0, share: 0, kills: 0, errors: 0, tips: 0, offBlock: 0, killPct: 0, eff: 0, origins: [], dirs: { line: 0, cross: 0, cut: 0 } };
    r.attempts++;
    if (isTip(e)) r.tips++;
    if (isOffBlock(e) && e.action === 'kill') r.offBlock++;
    if (e.action === 'kill') r.kills++;
    if (e.action === 'attack_error' || e.action === 'attack_blocked') r.errors++;
    const o = attackOrigin(e);
    if (o) { const x = r.origins.find((y) => y.key === o); if (x) x.n++; else r.origins.push({ key: o, n: 1 }); }
    const d = direction(e);
    if (d) r.dirs[d]++;
    att.set(e.player_id!, r);
  }
  const attackers = [...att.values()].map((r) => ({
    ...r, share: r.attempts / attacks.length, killPct: r.kills / r.attempts, eff: (r.kills - r.errors) / r.attempts,
    origins: r.origins.sort((a, b) => b.n - a.n),
  })).sort((a, b) => b.attempts - a.attempts);

  // Setter: where the ball goes after a good and after a bad first contact.
  const dist = (): Distribution => ({ n: 0, to: { '4': 0, '3': 0, '2': 0, back: 0 } });
  const setter = { good: dist(), bad: dist() };
  for (const c of attackContexts(rallies)) {
    const to = front(attackOrigin(c.attack));
    if (!to || c.quality == null) continue;
    const d = c.quality >= 2 ? setter.good : setter.bad;
    d.n++; d.to[to]++;
  }

  // Serve: who scores and who misses, and where they serve to.
  const srv = new Map<number, ServerRow>();
  for (const e of ev) {
    if (!['serve', 'ace', 'serve_error'].includes(e.action) || e.player_id == null || !byId.has(e.player_id)) continue;
    const r = srv.get(e.player_id) ?? { player: byId.get(e.player_id)!, n: 0, aces: 0, errors: 0, targets: [] };
    r.n++;
    if (e.action === 'ace') r.aces++;
    if (e.action === 'serve_error') r.errors++;
    const z = e.action !== 'serve_error' ? theirZone(e) : null;
    if (z) { const x = r.targets.find((y) => y.zone === z); if (x) x.n++; else r.targets.push({ zone: z, n: 1 }); }
    srv.set(e.player_id, r);
  }
  const servers = [...srv.values()].map((r) => ({ ...r, targets: r.targets.sort((a, b) => b.n - a.n) })).sort((a, b) => b.n - a.n);

  const lineups = new Map<number, Lineups | null | undefined>(matches.map((m) => [m.id, m.lineups]));
  const rot = rotationStats(ev, lineups, players);
  const rotations = rot.some((r) => r.receiving + r.serving > 0) ? rot : null;
  const points = pointSources(ev);

  const report: ScoutingReport = {
    matches: new Set(ev.map((e) => e.match_id)).size, sets, rallies: rallies.length,
    team, receivers, receiveZones: receptionZones(ev), attackers, setter, servers, rotations, points, serve: servePlan(players, ev), plan: [],
  };
  report.plan = gamePlan(report);
  return report;
}

/** The takeaways, strongest first, each with the numbers behind it. */
export function gamePlan(r: ScoutingReport): string[] {
  const out: string[] = [];
  const { team } = r;

  // Where to serve: the receiver and zone where they side out least.
  const t = r.serve.best[0];
  if (t && t.n >= MIN.receiver && t.gain >= 1) {
    out.push(`Best serve target: ${name(t.player)} in zone ${t.zone}. They side out ${pct(t.sideout)} there (${pct(r.serve.base)} on average): about ${t.gain.toFixed(0)} more points per 25 serves.`);
  }
  // Who to serve at.
  const weak = r.receivers.filter((x) => x.n >= MIN.receiver);
  if (weak.length >= 2 && team.recAvg != null) {
    const w = weak[0];
    if (w.avg < team.recAvg - 0.15) {
      out.push(`Serve at ${name(w.player)}: passes ${w.avg.toFixed(2)} on average (team ${team.recAvg.toFixed(2)}), ${pct(w.bad / w.n)} bad passes in ${w.n}.`);
    }
  }
  const zones = r.receiveZones.filter((z) => z.n >= MIN.receiver && z.value != null).sort((a, b) => a.value! - b.value!);
  if (zones.length >= 2 && team.recAvg != null && zones[0].value! < team.recAvg - 0.2) {
    out.push(`Their passing is weakest from zone ${zones[0].zone} (${zones[0].value!.toFixed(2)} on ${zones[0].n}).`);
  }

  // Their main hitters.
  for (const a of r.attackers.filter((x) => x.attempts >= MIN.attacker).slice(0, 2)) {
    const from = a.origins[0];
    const dirN = a.dirs.line + a.dirs.cross + a.dirs.cut;
    let t = `${name(a.player)} takes ${pct(a.share)} of their attacks (${a.kills} kills in ${a.attempts}, ${pct(a.killPct)})`;
    if (from && from.n / a.attempts >= 0.5) t += `, mostly from ${ORIGIN_WORD[from.key]}`;
    if (dirN >= 5) {
      const top = (['cross', 'line', 'cut'] as Direction[]).sort((x, y) => a.dirs[y] - a.dirs[x])[0];
      const share = a.dirs[top] / dirN;
      if (share >= 0.55) t += `; ${pct(share)} ${top === 'cut' ? 'sharp cuts along the net' : `${top} shots`}: ${top === 'line' ? 'block the line' : top === 'cross' ? 'close the cross with the block, defend the line' : 'keep a defender short'}`;
    }
    if (a.tips / a.attempts >= 0.2) t += `; ${a.tips} of the ${a.attempts} are tips: keep a defender up short behind the block`;
    if (a.kills >= 4 && a.offBlock / a.kills >= 0.3) t += `; ${a.offBlock} of the ${a.kills} kills off the block: hands in and firm, don't reach out wide`;
    out.push(`${t}.`);
  }

  // The setter's habits.
  const say = (d: Distribution, when: string) => {
    if (d.n < MIN.setterSplit) return;
    const [k, n] = (Object.entries(d.to) as [keyof Distribution['to'], number][]).sort((a, b) => b[1] - a[1])[0];
    if (n / d.n < 0.45) return;
    const where = k === 'back' ? 'the back row' : k === '3' ? 'the middle' : `zone ${k}`;
    out.push(`${when}, ${pct(n / d.n)} of their sets go to ${where} (${n} of ${d.n}).`);
  };
  say(r.setter.bad, 'After a bad pass or dig');
  say(r.setter.good, 'After a good pass');
  if (r.setter.good.n >= MIN.setterSplit && r.setter.good.to['3'] / r.setter.good.n < 0.1) out.push(`Their middle hardly gets the ball (${r.setter.good.to['3']} of ${r.setter.good.n} sets after a good pass): the middle blocker can help outside.`);

  // Serve.
  const tough = r.servers.filter((s) => s.n >= MIN.server && s.aces / s.n >= 0.15).sort((a, b) => b.aces / b.n - a.aces / a.n)[0];
  if (tough) out.push(`${name(tough.player)} is their toughest server: ${tough.aces} aces in ${tough.n}${tough.targets[0] ? `, mostly to zone ${tough.targets[0].zone}` : ''}.`);
  if (team.serves >= 15 && team.serveErrors / team.serves >= 0.15) out.push(`They miss ${pct(team.serveErrors / team.serves)} of their serves (${team.serveErrors} of ${team.serves}).`);

  // Rotations.
  if (r.rotations) {
    const so = r.rotations.filter((x) => x.receiving >= MIN.rotation).map((x) => ({ x, v: sideOutPct(x)! })).sort((a, b) => a.v - b.v);
    if (so.length >= 3) out.push(`Their side-out is weakest with their setter in position ${so[0].x.rotation} (${pct(so[0].v)} of ${so[0].x.receiving}) and best in ${so[so.length - 1].x.rotation} (${pct(so[so.length - 1].v)}).`);
    const br = r.rotations.filter((x) => x.serving >= MIN.rotation).map((x) => ({ x, v: breakPct(x)! })).sort((a, b) => b.v - a.v);
    if (br.length >= 3 && br[0].v >= 0.5) out.push(`They break most with their setter in position ${br[0].x.rotation} (${pct(br[0].v)} of ${br[0].x.serving} serves).`);
  }

  // How they lose points.
  // Unforced: attack, serve and setting errors (a dig, pass or block error is mostly forced by the other side).
  const own = r.points.lost.filter((b) => ['att', 'srv', 'set'].includes(b.key)).reduce((a, b) => a + b.value, 0);
  const lost = r.points.lost.reduce((a, b) => a + b.value, 0);
  if (lost >= 20 && r.sets && own / lost >= 0.3) out.push(`They give away ${(own / r.sets).toFixed(1)} points per set with attack, serve and setting errors (${pct(own / lost)} of the points they lose): keep the ball in play and make them play one more ball.`);

  return out;
}
