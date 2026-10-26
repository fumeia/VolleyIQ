import type { ActionCode } from './actions';
import type { AiField, AiPosition, AiStats, AiTouch } from './api';

/**
 * Turning the AI check's answers into changes on the review chips, and learning how
 * far to trust each kind of answer from how often it was right before.
 */

/** The AI check's action words, as our action codes. */
export const AI_ACTION: Record<string, ActionCode> = { serve: 'serve', receive: 'receive', set: 'set', attack: 'attack', block: 'block_touch', dig: 'dig', freeball: 'freeball' };

/** The AI's word for one of our actions (kill = attack, ace = serve, ...), to compare answers with what was saved. */
export function aiWord(code: ActionCode): string | null {
  if (['serve', 'ace', 'serve_error'].includes(code)) return 'serve';
  if (code === 'receive') return 'receive';
  if (['set', 'assist', 'set_error', 'assist_error'].includes(code)) return 'set';
  if (['attack', 'kill', 'attack_error', 'attack_blocked'].includes(code)) return 'attack';
  if (['block_touch', 'block_point', 'block_error'].includes(code)) return 'block';
  if (['dig', 'dig_error'].includes(code)) return 'dig';
  if (code === 'freeball') return 'freeball';
  return null;
}

/**
 * Court position (1..6) from where the AI saw our player, given which half we play on.
 * From behind our baseline (near half) the picture's left is the player's left:
 * front row 4-3-2, back row 5-6-1. On the far half the team faces the camera, so it is mirrored.
 */
export function courtPosition(pos: AiPosition | undefined, ourSide: 'near' | 'far' | null | undefined): number | null {
  if (!pos || pos === 'unsure' || !ourSide) return null;
  const near: Record<Exclude<AiPosition, 'unsure'>, number> = {
    'front-left': 4, 'front-middle': 3, 'front-right': 2, 'back-left': 5, 'back-middle': 6, 'back-right': 1,
  };
  const n = near[pos];
  if (ourSide === 'near') return n;
  return ({ 4: 2, 2: 4, 3: 3, 5: 1, 1: 5, 6: 6 } as Record<number, number>)[n];
}

/** Below this confidence an answer is only shown, not applied (until the stats say otherwise). */
export const AI_SURE = 0.6;
/** Where players stand at the contact is rougher than the rest (they switch after the serve). */
const DEFAULT_MIN: Record<AiField, number> = { contact: AI_SURE, team: AI_SURE, action: AI_SURE, jersey: AI_SURE, position: 0.75 };
/** Answers needed before the stats change anything. */
export const TRUST_AFTER = 20;

export interface Trust { min: number; off: boolean; rate: number | null; n: number }

/**
 * How far to trust one field: once there are [TRUST_AFTER] sure answers, a field that
 * was right less than 70% of the time is only shown, never applied; one that was right
 * 90%+ of the time is also applied when the AI is a little less sure.
 */
export function trustFor(stats: AiStats | null | undefined, field: AiField): Trust {
  const s = stats?.[field];
  const base = DEFAULT_MIN[field];
  if (!s || s.sureN < TRUST_AFTER) return { min: base, off: false, rate: s && s.sureN ? s.sureCorrect / s.sureN : null, n: s?.sureN ?? 0 };
  const rate = s.sureCorrect / s.sureN;
  return { min: rate >= 0.9 ? base - 0.15 : base, off: rate < 0.7, rate, n: s.sureN };
}

export interface AiPlan {
  /** Not a touch: remove the chip. */
  drop?: boolean;
  side?: 'us' | 'them';
  action?: ActionCode;
  player?: { id: number; via: 'jersey' | 'position' };
}

export interface PlanContext {
  stats: AiStats | null | undefined;
  /** The touch's action now, and whether a player is already set (a set player is never overwritten). */
  action: ActionCode;
  hasPlayer: boolean;
  /** Roster player by shirt number, and our player at a court position (1..6) for this rally. */
  byNumber: (n: number) => number | null;
  atPosition: (pos: number) => number | null;
}

/** What one answer changes on its chip, field by field, as far as each field is trusted. */
export function planAnswer(a: AiTouch, c: PlanContext): AiPlan {
  const ok = (f: AiField) => { const t = trustFor(c.stats, f); return !t.off && a.confidence >= t.min; };
  if (a.contact === 'no') return ok('contact') ? { drop: true } : {};
  const plan: AiPlan = {};
  if (a.team !== 'unsure' && ok('team')) plan.side = a.team === 'ours' ? 'us' : 'them';
  if (a.team === 'theirs') return plan;
  const code = AI_ACTION[a.action];
  if (code && code !== c.action && aiWord(c.action) !== a.action && ok('action')) plan.action = code;
  if (!c.hasPlayer) {
    const byNo = a.jersey != null ? c.byNumber(a.jersey) : null;
    const pos = courtPosition(a.position, a.ourSide);
    const byPos = pos != null ? c.atPosition(pos) : null;
    if (byNo != null && ok('jersey')) plan.player = { id: byNo, via: 'jersey' };
    else if (byNo == null && byPos != null && ok('position')) plan.player = { id: byPos, via: 'position' };
  }
  return plan;
}

export interface Saved {
  /** Kept as a touch (not removed as noise), counted as ours, its saved action and player. */
  kept: boolean;
  ours: boolean;
  action: ActionCode;
  playerId: number | null;
  /** Shirt number of the saved player. */
  number: number | null;
  /** The player the AI's position pointed to (null when it gave none). */
  positionPlayer: number | null;
}

/** Was each field the AI answered right, once the coach saved the touch? */
export function feedbackFor(a: AiTouch, s: Saved): { field: AiField; confidence: number; correct: boolean }[] {
  const out: { field: AiField; confidence: number; correct: boolean }[] = [];
  const add = (field: AiField, correct: boolean) => out.push({ field, confidence: a.confidence, correct });
  if (a.contact !== 'unsure') add('contact', (a.contact === 'yes') === s.kept);
  if (!s.kept || a.contact === 'no') return out;
  if (a.team !== 'unsure') add('team', (a.team === 'ours') === s.ours);
  // The other team's touches are not saved, so only our own say anything about action and player.
  if (!s.ours || a.team === 'theirs') return out;
  const word = aiWord(s.action);
  if (AI_ACTION[a.action] && word) add('action', a.action === word);
  if (a.jersey != null && s.number != null) add('jersey', a.jersey === s.number);
  if (s.positionPlayer != null && s.playerId != null) add('position', s.positionPlayer === s.playerId);
  return out;
}

/**
 * The most likely next touch after [prev]: its action and whether the same team plays
 * it. Serve → their pass → set → attack → the other side digs; a block is usually
 * played on by the blocking side; a dig or a free ball is set next.
 */
export function nextTouch(prev: ActionCode | null): { action: ActionCode; sameTeam: boolean } {
  const w = prev ? aiWord(prev) : null;
  switch (w) {
    case null: return { action: 'serve', sameTeam: true };
    case 'serve': return { action: 'receive', sameTeam: false };
    case 'receive': case 'dig': case 'freeball': return { action: 'set', sameTeam: true };
    case 'set': return { action: 'attack', sameTeam: true };
    case 'block': return { action: 'dig', sameTeam: true };
    default: return { action: 'dig', sameTeam: false };
  }
}
