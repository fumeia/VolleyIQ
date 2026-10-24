// Keep in sync with server/src/actions.js
export type ActionCode =
  | 'attack_error' | 'serve_error' | 'dig_error' | 'block_error'
  | 'attack' | 'serve' | 'dig' | 'block_touch'
  | 'kill' | 'ace' | 'block_point'
  | 'set' | 'assist' | 'assist_error'
  | 'receive'
  | 'opp_point' | 'opp_error';

export type Group = 'errors' | 'actions' | 'points' | 'setting' | 'receive' | 'team';

export interface ActionDef {
  code: ActionCode;
  label: string;
  short: string;
  group: Group;
  key?: string;           // desktop hotkey, same layout as VolleyTag
  zone?: boolean;         // ask for a court zone after tagging
  needsPlayer?: boolean;  // false for team-level actions
  score?: 'us' | 'them';  // effect on the scoreboard
}

export const ACTIONS: ActionDef[] = [
  { code: 'attack_error', label: 'Attack Error', short: 'Att Err', group: 'errors', key: 'q', zone: true, score: 'them' },
  { code: 'serve_error', label: 'Serve Error', short: 'Srv Err', group: 'errors', key: 'w', score: 'them' },
  { code: 'dig_error', label: 'Dig Error', short: 'Dig Err', group: 'errors', key: 'e', score: 'them' },
  { code: 'block_error', label: 'Block Error', short: 'Blk Err', group: 'errors', key: 'r', score: 'them' },
  { code: 'attack', label: 'Attack', short: 'Attack', group: 'actions', key: 'a', zone: true },
  { code: 'serve', label: 'Serve', short: 'Serve', group: 'actions', key: 's', zone: true },
  { code: 'dig', label: 'Dig', short: 'Dig', group: 'actions', key: 'd' },
  { code: 'block_touch', label: 'Block Touch', short: 'Blk Touch', group: 'actions', key: 'f' },
  { code: 'kill', label: 'Kill', short: 'Kill', group: 'points', key: 'z', zone: true, score: 'us' },
  { code: 'ace', label: 'Serve Ace', short: 'Ace', group: 'points', key: 'x', zone: true, score: 'us' },
  { code: 'block_point', label: 'Block Point', short: 'Blk Pt', group: 'points', key: 'v', score: 'us' },
  { code: 'set', label: 'Set', short: 'Set', group: 'setting', key: 'g' },
  { code: 'assist', label: 'Assist', short: 'Assist', group: 'setting', key: 't' },
  { code: 'assist_error', label: 'Assist Error', short: 'Ast Err', group: 'setting', key: 'y', score: 'them' },
  { code: 'receive', label: 'Receive', short: 'Rec', group: 'receive' },
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
