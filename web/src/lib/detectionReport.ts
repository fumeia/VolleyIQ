import type { ActionCode } from './actions';
import type { Player, VEvent } from './api';
import { aiWord } from './aiTrust';

/** One touch as the auto-detection reported it (kept per run on the server). */
export interface RunEvent {
  t: number; action: ActionCode; rally: number | null; poss: number | null;
  jersey: number | null; confidence: number | null; hint: 'quiet' | 'gap' | null; set_no: number | null;
}
export interface DetectionRun { id: number; created_at: string; params: Record<string, unknown> | null; events: RunEvent[] }

/** A detection within this many seconds of a saved touch is that touch. */
export const MATCH_WINDOW = 0.5;
const SKILLS = ['serve', 'receive', 'set', 'attack', 'block', 'dig', 'freeball'];

/**
 * How a detection run did against the touches saved for the match: which saved touches it
 * found, how far off in time, whether the action and the shirt number were right, and what
 * else it reported (the other team's touches, or noise).
 */
/** A detection further than this from any saved touch is in a part of the video nobody tagged. */
export const TAGGED_NEAR = 150;

export function detectionReport(run: RunEvent[], events: VEvent[], players: Player[]) {
  const all = [...run].filter((d) => d.t != null).sort((a, b) => a.t - b.t);
  const first = all[0]?.t ?? 0, last = all[all.length - 1]?.t ?? 0;
  // Our saved touches in the stretch of video the run covered (team entries and blocks without a touch are not touches).
  const truth = events
    .filter((e) => e.status === 'confirmed' && e.t != null && aiWord(e.action) != null && e.action !== 'block_miss' && e.t >= first - 3 && e.t <= last + 3)
    .sort((a, b) => a.t! - b.t!);
  // Only judge the parts that were tagged: a run covers the whole video, but maybe only one set
  // was tagged to test it. Detections more than 2.5 minutes from any saved touch are left out
  // (rallies follow each other well within that, even with a time-out; a set nobody tagged is far longer).
  const taggedTimes = events.filter((e) => e.status === 'confirmed' && e.t != null).map((e) => e.t!).sort((a, b) => a - b);
  const nearTag = (t: number) => {
    let lo = 0, hi = taggedTimes.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (taggedTimes[mid] < t) lo = mid + 1; else hi = mid; }
    return [taggedTimes[lo - 1], taggedTimes[lo]].some((x) => x != null && Math.abs(x - t) <= TAGGED_NEAR);
  };
  const dets = all.filter((d) => nearTag(d.t));
  const tagged = { minutes: dets.length ? Math.round((dets[dets.length - 1].t - dets[0].t) / 60) : 0, leftOut: all.length - dets.length };

  // One-to-one, closest pairs first.
  const pairs: { i: number; j: number; dt: number }[] = [];
  let j0 = 0;
  truth.forEach((e, i) => {
    while (j0 < dets.length && dets[j0].t < e.t! - MATCH_WINDOW) j0++;
    for (let j = j0; j < dets.length && dets[j].t <= e.t! + MATCH_WINDOW; j++) pairs.push({ i, j, dt: Math.abs(dets[j].t - e.t!) });
  });
  pairs.sort((a, b) => a.dt - b.dt);
  const truthHit = new Map<number, number>(), detHit = new Map<number, number>();
  for (const p of pairs) {
    if (truthHit.has(p.i) || detHit.has(p.j)) continue;
    truthHit.set(p.i, p.j);
    detHit.set(p.j, p.i);
  }
  const matched = [...truthHit].map(([i, j]) => ({ e: truth[i], d: dets[j] }));

  // Detections not matched: in a possession with one of our touches = extra (noise, a double);
  // in the other possessions of a rally we were in = probably the other team's touches.
  const ourPoss = new Set(matched.filter((m) => m.d.rally != null && m.d.poss != null).map((m) => `${m.d.rally}:${m.d.poss! % 2}`));
  const rallies = new Set(matched.map((m) => m.d.rally).filter((r) => r != null));
  let theirs = 0, extra = 0;
  dets.forEach((d, j) => {
    if (detHit.has(j)) return;
    if (d.rally != null && d.poss != null && rallies.has(d.rally) && !ourPoss.has(`${d.rally}:${d.poss % 2}`)) theirs++;
    else extra++;
  });

  const dts = matched.map((m) => m.d.t - m.e.t!).sort((a, b) => a - b);
  const median = (v: number[]) => (v.length ? v[Math.floor(v.length / 2)] : null);
  const actionRight = matched.filter((m) => aiWord(m.d.action) === aiWord(m.e.action));
  const confusion = new Map<string, number>();
  for (const m of matched) {
    const a = aiWord(m.e.action), b = aiWord(m.d.action);
    if (a && b && a !== b) confusion.set(`${a} read as ${b}`, (confusion.get(`${a} read as ${b}`) ?? 0) + 1);
  }
  const numberOf = (e: VEvent) => players.find((p) => p.id === e.player_id)?.number ?? e.jersey ?? null;
  const read = matched.filter((m) => m.d.jersey != null && numberOf(m.e) != null);

  const bySkill = SKILLS.map((k) => {
    const list = truth.map((e, i) => ({ e, i })).filter(({ e }) => aiWord(e.action) === k);
    return { skill: k, n: list.length, found: list.filter(({ i }) => truthHit.has(i)).length };
  }).filter((r) => r.n > 0);
  const byKind = (['heard', 'quiet', 'gap'] as const).map((k) => {
    const list = dets.map((d, j) => ({ d, j })).filter(({ d }) => (d.hint ?? 'heard') === k);
    return { kind: k, n: list.length, hits: list.filter(({ j }) => detHit.has(j)).length };
  }).filter((r) => r.n > 0);
  const byConfidence = ([[0, 0.4, 'below 0.4'], [0.4, 0.7, '0.4 to 0.7'], [0.7, 1.01, '0.7 and up']] as const).map(([lo, hi, label]) => {
    const list = dets.map((d, j) => ({ d, j })).filter(({ d }) => d.confidence != null && d.confidence >= lo && d.confidence < hi);
    return { label, n: list.length, hits: list.filter(({ j }) => detHit.has(j)).length };
  }).filter((r) => r.n > 0);

  return {
    truth: truth.length,
    detections: dets.length,
    tagged,
    found: matched.length,
    theirs,
    extra,
    timing: { median: median(dts), medianAbs: median(dts.map(Math.abs).sort((a, b) => a - b)) },
    actions: { n: matched.length, right: actionRight.length, confusion: [...confusion].sort((a, b) => b[1] - a[1]).slice(0, 5) },
    numbers: { read: read.length, right: read.filter((m) => m.d.jersey === numberOf(m.e)).length },
    bySkill,
    byKind,
    byConfidence,
  };
}
export type DetectionReport = ReturnType<typeof detectionReport>;
