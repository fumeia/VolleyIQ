// Keep in sync with web/src/lib/actions.ts
export const ACTIONS = [
  'attack_error', 'serve_error', 'dig_error', 'block_error', 'attack_blocked',
  'attack', 'serve', 'dig', 'block_touch', 'block_miss',
  'kill', 'ace', 'block_point',
  'set', 'assist', 'assist_error', 'set_error',
  'receive', 'freeball',
  'opp_point', 'opp_error',
  // Points scored while nobody tagged (live tagging paused): count for the score only.
  'gap_us', 'gap_them',
  // A kill or ace that nobody of the other side touched (straight to the floor): no score of its own.
  'untouched',
];

export const ROLES = ['OH', 'OPP', 'MB', 'S', 'L', 'DS'];
