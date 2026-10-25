import type { Player, VEvent } from '../../lib/api';
import { attackContexts, buildRallies, SETS } from '../../lib/sequence';
import { attackOrigin, eff, tally } from '../../lib/trajectory';
import { insightsFor, type Insight } from './insights';
import { eff3, pct } from './ui';

export interface Suggestion { title: string; why: string; how: string }
export interface Coaching { strengths: Insight[]; faults: Insight[]; suggestions: Suggestion[] }

const ZONE_NAME: Record<number, string> = { 1: 'right back (1)', 6: 'middle back (6)', 5: 'left back (5)', 4: 'left front (4)', 3: 'middle front (3)', 2: 'right front (2)' };

/**
 * Advice for one finding. The data decides which findings exist (and their numbers);
 * this only turns a kind of finding into something to practise.
 */
function adviceFor(i: Insight): Omit<Suggestion, 'why'> | null {
  const [kind, arg] = (i.key ?? '').split(':');
  switch (kind) {
    case 'attack': return { title: 'Attack: fewer free points for them', how: 'Pick a safe shot (high hands, deep corner, tool off the block) for tough balls instead of going full swing on every set.' };
    case 'attack-sideout': return { title: 'First-ball attack after the pass', how: 'Practise side-out swings off a live serve and pass, timing the approach with the setter on in-system balls.' };
    case 'attack-transition': return { title: 'Transition attack after a dig', how: 'Drill dig → get off the net → approach: open up early so a full approach is possible on high out-of-system sets.' };
    case 'shot-bad': return { title: `${arg === 'line' ? 'Line' : arg === 'cut' ? 'Sharp cut' : 'Cross'} shot`, how: 'Hit this shot in reps against a block or target, and use it as a change-up rather than the main option until it is reliable.' };
    case 'attack-err':
      if (arg === 'net') return { title: 'Attack errors into the net', how: 'Contact higher and in front of the hitting shoulder; work on the last two steps of the approach so the ball is not behind you.' };
      if (arg === 'long') return { title: 'Attacks going out long', how: 'More wrist snap and topspin; aim for the deep third, not the baseline. Off bad sets, roll shot to the deep middle.' };
      if (arg === 'wide') return { title: 'Attacks going out wide', how: 'Square the shoulders to the target earlier; aim a metre inside the sideline.' };
      if (arg === 'blocked') return { title: 'Getting blocked', how: 'Look at the block before contact: tool the outside hand, tip or roll over it, or hit high off the hands; vary the shot.' };
      return null;
    case 'serve-err': return { title: 'Serve consistency', how: 'Keep the same routine on every serve and choose a target; serve at 80% in tight phases of a set.' };
    case 'serve-miss': return arg === 'net'
      ? { title: 'Serves into the net', how: 'Toss a little higher and in front, and contact the ball at full reach.' }
      : { title: 'Serves going out long', how: 'Shorten the toss and aim for zone 6 depth; a flatter contact for floaters.' };
    case 'pass': return { title: 'Serve receive', how: 'Lots of live-serve passing reps: platform angled to the target before the ball arrives, feet first, then the arms.' };
    case 'pass-zone': {
      const z = Number(arg);
      return { title: `Passing in ${ZONE_NAME[z] ?? `zone ${arg}`}`, how: `Serve-receive reps with the serve aimed at zone ${arg}; agree with the neighbours who takes the seam there.` };
    }
    case 'aced': return { title: 'Avoid being aced', how: 'Read the server early and set the feet; on tough serves, a high pass to the middle of the court is better than a perfect-looking miss.' };
    case 'dig': return { title: 'Keeping digs in play', how: 'Defend lower and stable before the attack, and aim the dig high to the middle so the setter (or anyone) can play it.' };
    case 'balance': return { title: 'Fewer unforced errors', how: 'Count your errors per set in practice games; aim to win more points than you give away.' };
    default: return null;
  }
}

/** A player's strengths, faults and what to practise, from their tagged touches. */
export function playerCoaching(player: Player, events: VEvent[], players: Player[]): Coaching {
  const mine = events.filter((e) => e.player_id === player.id);
  const items = insightsFor(mine, events, 'player', players);
  const strengths = items.filter((i) => i.tone === 'good');
  const faults = items.filter((i) => i.tone === 'bad');

  // Setter: set errors and spreading the sets (not from insightsFor: it is about others' attacks).
  if (player.role === 'S') {
    const sets = mine.filter((e) => SETS.includes(e.action));
    const setErr = mine.filter((e) => e.action === 'set_error' || e.action === 'assist_error').length;
    if (sets.length >= 15) {
      const r = setErr / sets.length;
      if (r >= 0.05) faults.push({ tone: 'bad', text: `${setErr} set errors in ${sets.length} sets (${pct(r)})`, weight: 2, key: 'set-err' });
      else strengths.push({ tone: 'good', text: `Clean hands: ${setErr} set errors in ${sets.length} sets`, weight: 2 });
    }
    const ctx = attackContexts(buildRallies(events)).filter((c) => c.set?.player_id === player.id);
    if (ctx.length >= 15) {
      const lanes = new Map<string, VEvent[]>();
      for (const c of ctx) { const o = attackOrigin(c.attack) ?? '?'; lanes.set(o, [...(lanes.get(o) ?? []), c.attack]); }
      const top = [...lanes.entries()].filter(([k]) => k !== '?').sort((a, b) => b[1].length - a[1].length)[0];
      if (top && top[1].length / ctx.length >= 0.6) {
        const where = top[0] === 'back' ? 'the back row' : `position ${top[0]}`;
        faults.push({ tone: 'bad', text: `${pct(top[1].length / ctx.length)} of sets go to ${where} — predictable for the block`, weight: 2, key: 'set-spread' });
      }
      const k = eff(tally(ctx.map((c) => c.attack)));
      if (k != null && k >= 0.25) strengths.push({ tone: 'good', text: `Hitters convert the sets well: ${eff3(k)} attack efficiency off them (${ctx.length})`, weight: 2 });
    }
  }

  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();
  for (const f of faults) {
    let a = adviceFor(f);
    if (f.key === 'set-err') a = { title: 'Set errors', how: 'Square to the target early, take the ball above the forehead, and push with the legs; bump set rather than risk a double on a low pass.' };
    if (f.key === 'set-spread') a = { title: 'Spread the sets', how: 'Use the middle and the opposite more on good passes, so the block cannot sit on one hitter.' };
    if (!a || seen.has(a.title)) continue;
    seen.add(a.title);
    suggestions.push({ ...a, why: f.text });
  }
  return { strengths, faults, suggestions: suggestions.slice(0, 5) };
}
