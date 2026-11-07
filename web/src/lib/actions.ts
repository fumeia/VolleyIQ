// Keep in sync with server/src/actions.js
export type ActionCode =
  | 'attack_error' | 'serve_error' | 'dig_error' | 'block_error' | 'attack_blocked'
  | 'attack' | 'serve' | 'dig' | 'block_touch'
  /** Jumped to block, the ball went past without a touch (not a ball contact). */
  | 'block_miss'
  | 'kill' | 'ace' | 'block_point'
  | 'set' | 'assist' | 'assist_error' | 'set_error'
  | 'receive' | 'freeball'
  | 'opp_point' | 'opp_error'
  /** A point scored while nobody tagged (live tagging paused): counts for the score only. */
  | 'gap_us' | 'gap_them';

export type Group = 'errors' | 'actions' | 'points' | 'setting' | 'receive' | 'team' | 'gap';

/**
 * Court taps for an action: 'path' = where the ball was played from, then where it
 * went (two taps, either can be skipped); 'at' = one spot (a block, along the net).
 */
export type CourtTaps = 'path' | 'at';

export interface ActionDef {
  code: ActionCode;
  label: string;
  short: string;
  group: Group;
  key?: string;           // desktop hotkey, same layout as VolleyTag
  court?: CourtTaps;
  fromPrompt?: string;    // 'path': first tap
  toPrompt?: string;      // 'path': second tap; 'at': the one tap
  needsPlayer?: boolean;  // false for team-level actions
  score?: 'us' | 'them';  // effect on the scoreboard
}

export const ACTIONS: ActionDef[] = [
  { code: 'attack_error', label: 'Attack Error', short: 'Att Err', group: 'errors', key: 'q', court: 'path', fromPrompt: 'Where was the attack hit from?', toPrompt: 'Where did it go (out / net)?', score: 'them' },
  { code: 'serve_error', label: 'Serve Error', short: 'Srv Err', group: 'errors', key: 'w', court: 'path', fromPrompt: 'Where was the serve hit from?', toPrompt: 'Where did it go (out / net)?', score: 'them' },
  { code: 'dig_error', label: 'Dig Error', short: 'Dig Err', group: 'errors', key: 'e', court: 'path', fromPrompt: 'Where was the dig?', toPrompt: 'Where did it go?', score: 'them' },
  { code: 'attack_blocked', label: 'Attack Blocked', short: 'Blocked', group: 'errors', key: 'c', court: 'path', fromPrompt: 'Where was the attack hit from?', toPrompt: 'Where was it blocked?', score: 'them' },
  { code: 'block_error', label: 'Block Error', short: 'Blk Err', group: 'errors', key: 'r', court: 'at', toPrompt: 'Where along the net?', score: 'them' },
  { code: 'attack', label: 'Attack', short: 'Attack', group: 'actions', key: 'a', court: 'path', fromPrompt: 'Where was the attack hit from?', toPrompt: 'Where did it go?' },
  { code: 'serve', label: 'Serve', short: 'Serve', group: 'actions', key: 's', court: 'path', fromPrompt: 'Where was the serve hit from?', toPrompt: 'Where did it land?' },
  { code: 'dig', label: 'Dig', short: 'Dig', group: 'actions', key: 'd', court: 'path', fromPrompt: 'Where was the dig?', toPrompt: 'Where did it go?' },
  { code: 'freeball', label: 'Free Ball', short: 'Free', group: 'actions', key: 'b', court: 'path', fromPrompt: 'Where was the free ball played?', toPrompt: 'Where did it go?' },
  { code: 'block_touch', label: 'Block Touch', short: 'Blk Touch', group: 'actions', key: 'f', court: 'at', toPrompt: 'Where along the net?' },
  { code: 'kill', label: 'Kill', short: 'Kill', group: 'points', key: 'z', court: 'path', fromPrompt: 'Where was the attack hit from?', toPrompt: 'Where did it land?', score: 'us' },
  { code: 'ace', label: 'Serve Ace', short: 'Ace', group: 'points', key: 'x', court: 'path', fromPrompt: 'Where was the serve hit from?', toPrompt: 'Where did it land?', score: 'us' },
  { code: 'block_miss', label: 'Block, no touch', short: 'Blk none', group: 'actions', key: 'h', court: 'path', fromPrompt: 'Where along the net was the block?', toPrompt: 'Where did the ball go?' },
  { code: 'block_point', label: 'Block Point', short: 'Blk Pt', group: 'points', key: 'v', court: 'path', fromPrompt: 'Where along the net was the block?', toPrompt: 'Where did the ball land? (skip if unsure)', score: 'us' },
  { code: 'set', label: 'Set', short: 'Set', group: 'setting', key: 'g', court: 'path', fromPrompt: 'Where was the set made?', toPrompt: 'Where did the set go?' },
  { code: 'assist', label: 'Bump set', short: 'Bump set', group: 'setting', key: 't', court: 'path', fromPrompt: 'Where was the set made?', toPrompt: 'Where did the set go?' },
  { code: 'assist_error', label: 'Bump set error', short: 'Bump err', group: 'setting', key: 'y', court: 'path', fromPrompt: 'Where was the set made?', toPrompt: 'Where did the set go?', score: 'them' },
  { code: 'set_error', label: 'Set Error', short: 'Set Err', group: 'setting', key: 'u', court: 'path', fromPrompt: 'Where was the set made?', toPrompt: 'Where did the set go?', score: 'them' },
  { code: 'receive', label: 'Receive', short: 'Rec', group: 'receive', court: 'path', fromPrompt: 'Where was it received?', toPrompt: 'Where did the pass go?' },
  { code: 'opp_error', label: 'Opponent Error', short: 'Opp Err', group: 'team', needsPlayer: false, score: 'us' },
  { code: 'opp_point', label: 'Opponent Point', short: 'Opp Pt', group: 'team', needsPlayer: false, score: 'them' },
  { code: 'gap_us', label: 'Our point (not tagged)', short: 'Pt (gap)', group: 'gap', needsPlayer: false, score: 'us' },
  { code: 'gap_them', label: 'Their point (not tagged)', short: 'Opp (gap)', group: 'gap', needsPlayer: false, score: 'them' },
];

/** Action choices in review, grouped serve, pass, set, attack, defence, block: every player action. */
export const REVIEW_ACTIONS: ActionCode[] = [
  'serve', 'ace', 'serve_error', 'receive', 'set', 'assist', 'set_error', 'assist_error',
  'attack', 'kill', 'attack_error', 'attack_blocked', 'dig', 'dig_error', 'freeball',
  'block_touch', 'block_point', 'block_error', 'block_miss',
];

/**
 * Blocks are placed along the net: the spot of a block (touch, point, error), and the
 * first spot of a block without a touch (then where the ball went).
 */
export function isNetSpot(code: ActionCode, first: boolean): boolean {
  return ['block_touch', 'block_error'].includes(code) || ((code === 'block_miss' || code === 'block_point') && first);
}

/** "Fast" court mode: the court spots that matter most for the stats. */
export const KEY_SPOTS: ActionCode[] = ['serve', 'ace', 'serve_error', 'receive', 'attack', 'kill', 'attack_error', 'attack_blocked'];

/** Whether to ask for court spots for [code] under the tagging settings. */
export function wantsSpots(code: ActionCode, location: 'points' | 'zones' | 'off', scope: 'all' | 'key'): boolean {
  return !!ACTIONS.find((a) => a.code === code)?.court && location !== 'off' && (scope !== 'key' || KEY_SPOTS.includes(code));
}

/** The action pad, one row per skill: you know the skill first, then the outcome. */
export const SKILLS: { label: string; codes: ActionCode[] }[] = [
  { label: 'Serve', codes: ['serve', 'ace', 'serve_error'] },
  { label: 'Receive', codes: ['receive'] },
  { label: 'Set', codes: ['set', 'assist', 'set_error', 'assist_error'] },
  { label: 'Attack', codes: ['attack', 'kill', 'attack_error', 'attack_blocked'] },
  { label: 'Block', codes: ['block_touch', 'block_point', 'block_error', 'block_miss'] },
  { label: 'Defence', codes: ['dig', 'freeball', 'dig_error'] },
];
/** Labels inside a skill row (the row already names the skill). */
export const SHORT: Partial<Record<ActionCode, string>> = {
  serve: 'In play', ace: 'Ace', serve_error: 'Error', receive: 'Receive → tap court',
  set: 'Set', assist: 'Bump set', set_error: 'Error', assist_error: 'Bump err',
  attack: 'In play', kill: 'Kill', attack_error: 'Error', attack_blocked: 'Blocked',
  block_touch: 'Touch', block_point: 'Point', block_error: 'Error', block_miss: 'No touch',
  dig: 'Dig', freeball: 'Free ball', dig_error: 'Error',
};

export const ACTION_BY_CODE = Object.fromEntries(ACTIONS.map((a) => [a.code, a])) as Record<ActionCode, ActionDef>;

/**
 * Who a tag gives the point to: the action's own effect, and a reception error
 * (pass graded 0 = aced) is the opponent's point too.
 */
export function scoreOf(e: { action: ActionCode; value?: number | null; noPoint?: boolean }): 'us' | 'them' | undefined {
  // A blocked attack answered by the other side's block point: that one scores (see lib/pairs).
  if (e.noPoint) return undefined;
  // A pass graded 0 is not a point by itself (it can be rescued): their ace is the
  // "They won" / opponent point tagged after it.
  return ACTION_BY_CODE[e.action]?.score;
}

export const GROUPS: { id: Group; label: string }[] = [
  { id: 'points', label: 'Points' },
  { id: 'actions', label: 'Actions' },
  { id: 'errors', label: 'Errors' },
  { id: 'setting', label: 'Setting' },
];

export const ROLES = [
  { code: 'OH', label: 'Outside Hitter' },
  { code: 'OPP', label: 'Opposite' },
  { code: 'MB', label: 'Middle Blocker' },
  { code: 'S', label: 'Setter' },
  { code: 'L', label: 'Libero' },
  { code: 'DS', label: 'Defensive Specialist' },
] as const;

export type RoleCode = (typeof ROLES)[number]['code'];

/**
 * Attack actions, and the kind of shot in their value: none = a hit, TIP = a tip / feint,
 * OFF_BLOCK = played off the opponent's block (block-out, tool).
 */
export const ATTACK_CODES: ActionCode[] = ['attack', 'kill', 'attack_error', 'attack_blocked'];
export const TIP = 1;
export const OFF_BLOCK = 2;
export const isTip = (e: { action: ActionCode; value?: number | null }) => ATTACK_CODES.includes(e.action) && e.value === TIP;
export const isOffBlock = (e: { action: ActionCode; value?: number | null }) => ATTACK_CODES.includes(e.action) && e.value === OFF_BLOCK;
/** A block touch that sent the ball out (the attack scored "off the block"): a block error without its own point. */
export const TOUCHED_OUT = 2;
export const isTouchedOut = (e: { action: ActionCode; value?: number | null }) => e.action === 'block_touch' && e.value === TOUCHED_OUT;
export type Shot = 'hit' | 'tip' | 'block';
export const shotOf = (e: { action: ActionCode; value?: number | null }): Shot => (isTip(e) ? 'tip' : isOffBlock(e) ? 'block' : 'hit');
export const SHOTS: { key: Shot; label: string; value: number | null }[] = [
  { key: 'hit', label: 'Hit', value: null }, { key: 'tip', label: 'Tip / feint', value: TIP }, { key: 'block', label: 'Off the block', value: OFF_BLOCK },
];
const TIP_LABEL: Partial<Record<ActionCode, string>> = { attack: 'Tip', kill: 'Tip kill', attack_error: 'Tip error', attack_blocked: 'Tip blocked' };
const OFF_BLOCK_LABEL: Partial<Record<ActionCode, string>> = { attack: 'Attack off the block', kill: 'Kill off the block', attack_error: 'Off the block, error', attack_blocked: 'Blocked' };

export function actionLabel(e: { action: ActionCode; value?: number | null }) {
  const def = ACTION_BY_CODE[e.action];
  if (!def) return e.action;
  if (isTip(e)) return TIP_LABEL[e.action]!;
  if (isOffBlock(e)) return OFF_BLOCK_LABEL[e.action]!;
  if (isTouchedOut(e)) return 'Block touched out';
  return e.action === 'receive' && e.value != null ? `Receive ${e.value}` : def.label;
}

/** A point scored while nobody tagged: counts for the score, but nothing is known about the rally. */
export const isGap = (e: { action: ActionCode }) => e.action === 'gap_us' || e.action === 'gap_them';
