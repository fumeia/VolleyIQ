// Keep in sync with server/src/actions.js
export type ActionCode =
  | 'attack_error' | 'serve_error' | 'dig_error' | 'block_error' | 'attack_blocked'
  | 'attack' | 'serve' | 'dig' | 'block_touch'
  | 'kill' | 'ace' | 'block_point'
  | 'set' | 'assist' | 'assist_error'
  | 'receive'
  | 'opp_point' | 'opp_error';

export type Group = 'errors' | 'actions' | 'points' | 'setting' | 'receive' | 'team';

/** Which half to tap for the court spot: where the ball landed on their side, or where it happened on ours. */
export type Spot = 'theirs' | 'ours';

export interface ActionDef {
  code: ActionCode;
  label: string;
  short: string;
  group: Group;
  key?: string;           // desktop hotkey, same layout as VolleyTag
  spot?: Spot;            // ask for a court spot, on this half
  spotPrompt?: string;
  needsPlayer?: boolean;  // false for team-level actions
  score?: 'us' | 'them';  // effect on the scoreboard
}

export const ACTIONS: ActionDef[] = [
  { code: 'attack_error', label: 'Attack Error', short: 'Att Err', group: 'errors', key: 'q', spot: 'theirs', spotPrompt: 'Where did the ball go?', score: 'them' },
  { code: 'serve_error', label: 'Serve Error', short: 'Srv Err', group: 'errors', key: 'w', spot: 'theirs', spotPrompt: 'Where did the ball go?', score: 'them' },
  { code: 'dig_error', label: 'Dig Error', short: 'Dig Err', group: 'errors', key: 'e', spot: 'ours', spotPrompt: 'Where was the dig?', score: 'them' },
  { code: 'attack_blocked', label: 'Attack Blocked', short: 'Blocked', group: 'errors', key: 'c', spot: 'ours', spotPrompt: 'Where along the net were they blocked?', score: 'them' },
  { code: 'block_error', label: 'Block Error', short: 'Blk Err', group: 'errors', key: 'r', spot: 'ours', spotPrompt: 'Where along the net?', score: 'them' },
  { code: 'attack', label: 'Attack', short: 'Attack', group: 'actions', key: 'a', spot: 'theirs', spotPrompt: 'Where did the ball land?' },
  { code: 'serve', label: 'Serve', short: 'Serve', group: 'actions', key: 's', spot: 'theirs', spotPrompt: 'Where did the ball land?' },
  { code: 'dig', label: 'Dig', short: 'Dig', group: 'actions', key: 'd', spot: 'ours', spotPrompt: 'Where was the dig?' },
  { code: 'block_touch', label: 'Block Touch', short: 'Blk Touch', group: 'actions', key: 'f', spot: 'ours', spotPrompt: 'Where along the net?' },
  { code: 'kill', label: 'Kill', short: 'Kill', group: 'points', key: 'z', spot: 'theirs', spotPrompt: 'Where did the ball land?', score: 'us' },
  { code: 'ace', label: 'Serve Ace', short: 'Ace', group: 'points', key: 'x', spot: 'theirs', spotPrompt: 'Where did the ball land?', score: 'us' },
  { code: 'block_point', label: 'Block Point', short: 'Blk Pt', group: 'points', key: 'v', spot: 'ours', spotPrompt: 'Where along the net?', score: 'us' },
  { code: 'set', label: 'Set', short: 'Set', group: 'setting', key: 'g' },
  { code: 'assist', label: 'Assist', short: 'Assist', group: 'setting', key: 't' },
  { code: 'assist_error', label: 'Assist Error', short: 'Ast Err', group: 'setting', key: 'y', score: 'them' },
  { code: 'receive', label: 'Receive', short: 'Rec', group: 'receive', spot: 'ours', spotPrompt: 'Where did the pass land?' },
  { code: 'opp_error', label: 'Opponent Error', short: 'Opp Err', group: 'team', needsPlayer: false, score: 'us' },
  { code: 'opp_point', label: 'Opponent Point', short: 'Opp Pt', group: 'team', needsPlayer: false, score: 'them' },
];

export const ACTION_BY_CODE = Object.fromEntries(ACTIONS.map((a) => [a.code, a])) as Record<ActionCode, ActionDef>;

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

export function actionLabel(e: { action: ActionCode; value?: number | null }) {
  const def = ACTION_BY_CODE[e.action];
  if (!def) return e.action;
  return e.action === 'receive' && e.value != null ? `Receive ${e.value}` : def.label;
}
