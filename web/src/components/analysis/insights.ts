import type { VEvent } from '../../lib/api';
import { ATTACKS, attackContexts, buildRallies, phaseScoring, SERVES, transitionConversion, winByLength } from '../../lib/sequence';
import { DIRECTIONS, direction, eff, ERROR_KINDS, errorKind, errorPct, ourZone, pointPct, splitBy, tally } from '../../lib/trajectory';
import { ERROR_TYPES } from './ErrorsSection';
import { eff3, judge, pct, plural, ratio, type Tone } from './ui';

export interface Insight { tone: Exclude<Tone, null>; text: string; weight: number }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const push = (out: Insight[], tone: Tone, text: string, weight: number) => { if (tone) out.push({ tone, text, weight }); };

/**
 * Plain-language strengths and things to work on, from a set of tags (a player's
 * or the whole team's). [rallyEvents] are all tags (for the context of each touch).
 */
export function insightsFor(mine: VEvent[], rallyEvents: VEvent[], scope: 'player' | 'team'): Insight[] {
  const out: Insight[] = [];
  const ids = new Set(mine.map((e) => e.id));

  // Attack
  const attacks = mine.filter((e) => ATTACKS.includes(e.action));
  const at = tally(attacks);
  if (at.n >= 5) push(out, judge.eff(eff(at)), `Attack efficiency ${eff3(eff(at))} (${plural(at.points, 'kill')}, ${plural(at.errors, 'error')} in ${at.n})`, 3);
  const ctx = attackContexts(buildRallies(rallyEvents)).filter((c) => ids.has(c.attack.id));
  const so = tally(ctx.filter((c) => c.phase === 'sideout').map((c) => c.attack));
  const tr = tally(ctx.filter((c) => c.phase === 'transition').map((c) => c.attack));
  if (so.n >= 4 && tr.n >= 4 && Math.abs((eff(so) ?? 0) - (eff(tr) ?? 0)) >= 0.2) {
    const worse = (eff(so) ?? 0) < (eff(tr) ?? 0) ? ['side-out (after our pass)', so] as const : ['transition (after a dig)', tr] as const;
    push(out, 'bad', `Weaker in ${worse[0]}: ${eff3(eff(worse[1]))} on ${worse[1].n} attacks`, 2);
  }
  const p3 = tally(ctx.filter((c) => c.phase === 'sideout' && c.quality === 3).map((c) => c.attack));
  const pLow = tally(ctx.filter((c) => c.phase === 'sideout' && c.quality != null && c.quality <= 1).map((c) => c.attack));
  if (scope === 'team' && p3.n >= 4 && pLow.n >= 4) {
    const gap = (eff(p3) ?? 0) - (eff(pLow) ?? 0);
    if (gap >= 0.25) push(out, 'bad', `Attack after a poor pass ${eff3(eff(pLow))} vs ${eff3(eff(p3))} after a perfect one — the pass decides our attack`, 3);
    else if ((eff(pLow) ?? 0) > 0.15) push(out, 'good', `Attack holds up after poor passes: ${eff3(eff(pLow))} (${pLow.n} attacks)`, 2);
  }
  const dirs = splitBy(attacks, direction, DIRECTIONS.map((d) => d.key));
  const dirRows = DIRECTIONS.map((d) => ({ label: d.label, t: dirs.get(d.key)! })).filter((r) => r.t.n >= 4);
  if (dirRows.length >= 2) {
    const best = [...dirRows].sort((a, b) => (eff(b.t) ?? 0) - (eff(a.t) ?? 0))[0];
    const worst = [...dirRows].sort((a, b) => (eff(a.t) ?? 0) - (eff(b.t) ?? 0))[0];
    if ((eff(best.t) ?? 0) > 0.15) push(out, 'good', `${best.label} shots work: ${eff3(eff(best.t))}, ${pct(pointPct(best.t))} kills (${best.t.n})`, 2);
    if (worst !== best && (eff(worst.t) ?? 0) < 0) push(out, 'bad', `${worst.label} shots ${eff3(eff(worst.t))} (${worst.t.n} attacks)`, 2);
  }
  const attErr = attacks.filter((e) => e.action === 'attack_error' || e.action === 'attack_blocked');
  if (attErr.length >= 3) {
    const kinds = ERROR_KINDS.map((k) => ({ k, n: attErr.filter((e) => errorKind(e) === k.key).length })).sort((a, b) => b.n - a.n);
    if (kinds[0].n >= 2 && kinds[0].n / attErr.length >= 0.4 && kinds[0].k.key !== 'other') {
      push(out, 'bad', `${kinds[0].n} of ${attErr.length} attack errors: ${kinds[0].k.label.toLowerCase()}`, 2);
    }
  }

  // Serve
  const serves = mine.filter((e) => SERVES.includes(e.action));
  const sv = tally(serves);
  if (sv.n >= 6) {
    push(out, judge.serveErrPct(errorPct(sv)), `Serve errors ${pct(errorPct(sv))} (${sv.errors} of ${sv.n})`, 2);
    if ((pointPct(sv) ?? 0) >= 0.1) push(out, 'good', `${plural(sv.points, 'ace')} (${pct(pointPct(sv))} of serves)`, 2);
    const serr = serves.filter((e) => e.action === 'serve_error');
    const net = serr.filter((e) => errorKind(e) === 'net').length, long = serr.filter((e) => errorKind(e) === 'long').length;
    if (serr.length >= 3 && Math.max(net, long) / serr.length >= 0.5) push(out, 'bad', `Missed serves mostly ${net >= long ? 'into the net' : 'long'} (${Math.max(net, long)} of ${serr.length})`, 1);
  }

  // Serve receive
  const passes = mine.filter((e) => e.action === 'receive' && e.value != null);
  if (passes.length >= 5) {
    const a = mean(passes.map((e) => e.value!));
    push(out, judge.passAvg(a), `Pass average ${a!.toFixed(2)} on ${passes.length} serves (${pct(ratio(passes.filter((e) => e.value === 3).length, passes.length))} perfect)`, 3);
    const zs = [1, 6, 5, 4, 3, 2].map((z) => ({ z, vs: passes.filter((e) => ourZone(e) === z).map((e) => e.value!) })).filter((x) => x.vs.length >= 3);
    const weak = zs.sort((x, y) => mean(x.vs)! - mean(y.vs)!)[0];
    if (weak && mean(weak.vs)! < 1.6) push(out, 'bad', `Passes taken in zone ${weak.z}: average ${mean(weak.vs)!.toFixed(1)} (${weak.vs.length})`, 2);
    const aced = passes.filter((e) => e.value === 0).length;
    if (aced >= 3) push(out, 'bad', `Aced ${aced} times`, 2);
  }

  // Defence & block
  const digs = mine.filter((e) => e.action === 'dig' || e.action === 'dig_error');
  if (digs.length >= 5) {
    const lost = digs.filter((e) => e.action === 'dig_error').length;
    const kept = 1 - lost / digs.length;
    push(out, kept >= 0.8 ? 'good' : kept < 0.6 ? 'bad' : null, `${pct(kept)} of digs kept in play (${digs.length - lost} of ${digs.length})`, 1);
  }
  const bp = mine.filter((e) => e.action === 'block_point').length;
  if (bp >= 2) push(out, 'good', `${bp} block points`, 1);

  // Team-only: phases, transition, errors, rally length
  if (scope === 'team') {
    const rallies = buildRallies(rallyEvents);
    const ph = phaseScoring(rallies);
    if (ph.sideout.n >= 8) push(out, judge.sideout(ph.sideoutPct), `Side-out ${pct(ph.sideoutPct)} when they served (${ph.sideout.won}/${ph.sideout.n})`, 4);
    if (ph.break.n >= 8) push(out, judge.break(ph.breakPct), `Break points ${pct(ph.breakPct)} on our serve (${ph.break.won}/${ph.break.n})`, 4);
    const tc = transitionConversion(rallies);
    if (tc.n >= 8) push(out, judge.conversion(tc.killPct), `Transition: ${pct(tc.killPct)} of digs/free balls turned into a kill`, 3);
    const errs = rallyEvents.filter((e) => ERROR_TYPES.some((t) => t.test(e)));
    if (errs.length >= 6) {
      const top = ERROR_TYPES.map((t) => ({ t, n: errs.filter(t.test).length })).sort((a, b) => b.n - a.n)[0];
      if (top.n / errs.length >= 0.3) push(out, 'bad', `Most points given away: ${top.t.label.toLowerCase()} (${top.n} of ${errs.length} errors)`, 3);
    }
    const long = winByLength(rallies).find((b) => b.label === '7+');
    if (long && long.n >= 5) push(out, judge.win(ratio(long.won, long.n)), `Long rallies (7+ touches): won ${long.won} of ${long.n}`, 1);
  } else {
    // Player: overall balance
    const pts = mine.filter((e) => ['kill', 'ace', 'block_point'].includes(e.action)).length;
    const errs = mine.filter((e) => ERROR_TYPES.some((t) => t.test(e))).length;
    if (pts + errs >= 6) push(out, judge.plusMinus(pts - errs), `${plural(pts, 'point')} won, ${errs} given away (${pts - errs > 0 ? '+' : ''}${pts - errs})`, 2);
  }

  return out.sort((a, b) => b.weight - a.weight);
}
