import { api, type AiBudget, type AiTouch, type Match, type Player, type VEvent } from './api';
import { ourHalfAt } from './calibration';
import { touchPictures } from './frames';
import type { RallyGroup } from './rallyReview';

/** The AI check of one rally or of every rally, and what it is likely to cost. */

const load = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch { return d; } };
const save = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

/** AI options, remembered on this device. */
export const aiPrefs = {
  /** Send up to 3 of the coach's corrected touches along as examples (more pictures per check, so it costs more). */
  examples: () => load('viq:aiExamples', false),
  setExamples: (v: boolean) => save('viq:aiExamples', v),
  /** Check every rally with the AI as soon as the auto-detection is done. */
  afterDetect: () => load('viq:aiAfterDetect', false),
  setAfterDetect: (v: boolean) => save('viq:aiAfterDetect', v),
};

export interface CheckContext { match: Match; players: Player[]; url: string; examples: boolean }

/** Check the touches of one rally (up to 16), keep the answers with the suggestions, and return them by event id. */
export async function checkRally(events: VEvent[], c: CheckContext, onStep?: (text: string) => void): Promise<Map<number, AiTouch>> {
  const list = events.filter((e) => e.t != null).slice(0, 16);
  const out = new Map<number, AiTouch>();
  if (!list.length) return out;
  onStep?.('Reading frames…');
  const pics = await touchPictures(c.url, list.map((e) => e.t!), (k) => `Touch ${k + 1} of ${list.length}`,
    (d) => onStep?.(`Reading frames ${d}/${list.length}…`));
  onStep?.('Asking the AI…');
  const half = c.match.calibration ? ourHalfAt(c.match.calibration, list[0].t!) : null;
  const ourSide = half === 'near' || half === 'far' ? half : null;
  const { touches } = await api.touchCheck({
    images: pics.map((data) => ({ media_type: 'image/jpeg', data })),
    ourSide,
    roster: c.players.filter((p) => p.active && p.number != null).map((p) => ({ number: p.number!, role: p.role })),
    examples: c.examples,
  });
  for (const a of touches) {
    const e = list[a.i - 1];
    if (e) out.set(e.id, { ...a, ourSide });
  }
  // Kept with the suggestions, so the answers are there when the rally is reviewed later.
  await api.saveAi(c.match.id, [...out].map(([id, ai]) => ({ id, ai }))).catch(() => {});
  return out;
}

/**
 * Check every rally that has no AI answers yet, one request per rally. Stops at the
 * daily limit or when [stop] says so; returns how many rallies were checked.
 */
export async function checkAll(rallies: RallyGroup[], c: CheckContext, onProgress: (done: number, total: number, note?: string) => void, stop: () => boolean) {
  const todo = rallies.filter((r) => r.events.some((e) => e.t != null && !e.ai));
  let done = 0;
  for (const r of todo) {
    if (stop()) break;
    try {
      await checkRally(r.events, c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Out of checks for today, or the gateway refused (budget): no point in going on.
      if (/limit|budget|429|402/i.test(msg)) { onProgress(done, todo.length, msg); return done; }
    }
    done++;
    onProgress(done, todo.length);
  }
  return done;
}

/** Touches that a run would check (rallies without answers; at most 16 per rally). */
export function touchesToCheck(rallies: RallyGroup[]) {
  return rallies.reduce((n, r) => n + (r.events.some((e) => e.t != null && !e.ai) ? Math.min(16, r.events.filter((e) => e.t != null).length) : 0), 0);
}

/** Money in the gateway's unit: $0.42, 12 CHF. */
export function money(v: number, currency: string) {
  const n = v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(0);
  return currency.length === 1 ? `${currency}${n}` : `${n} ${currency}`;
}

/**
 * What checking [touches] touches in [requests] requests is likely to cost, and whether
 * the credit and today's limit allow it. Examples add up to 3 pictures to every request.
 */
export function estimate(b: AiBudget | null, touches: number, requests: number, examples: boolean) {
  const pictures = touches + (examples ? b?.maxExamples ?? 3 : 0) * requests;
  const cost = b?.perTouch != null ? b.perTouch * pictures : null;
  const left = b ? b.today.limit - b.today.used : null;
  const overDay = left != null && requests > left;
  const overBudget = cost != null && b?.remaining != null && cost > b.remaining;
  return { pictures, cost, overDay, overBudget, ok: !overDay && !overBudget };
}
