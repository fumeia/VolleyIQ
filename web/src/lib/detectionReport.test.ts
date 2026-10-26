import { describe, expect, it } from 'vitest';
import type { Player, VEvent } from './api';
import { detectionReport, type RunEvent } from './detectionReport';

let id = 0;
const tag = (t: number, action: VEvent['action'], player_id: number | null = 1): VEvent => ({
  id: ++id, match_id: 1, player_id, jersey: null, action, value: null, zone: null, x: null, y: null, t, set_no: 1, source: 'manual', status: 'confirmed', confidence: null,
});
const det = (t: number, action: RunEvent['action'], poss: number, extra: Partial<RunEvent> = {}): RunEvent => ({ t, action, rally: 1, poss, jersey: null, confidence: 0.8, hint: null, set_no: 1, ...extra });
const players = [{ id: 1, number: 7 }, { id: 2, number: 9 }] as Player[];

describe('detection report', () => {
  it('matches detections to saved touches one to one and scores actions and numbers', () => {
    // We serve (poss 0), they pass and attack (poss 1), we dig and set (poss 2), our attack is missed by the detector.
    const saved = [tag(10, 'serve'), tag(14, 'dig', 2), tag(15, 'set'), tag(16, 'kill', 2), tag(30, 'opp_point', null)];
    const run = [
      det(10.1, 'serve', 0, { jersey: 7 }), det(11.5, 'receive', 1), det(12.5, 'attack', 1),
      det(13.9, 'dig', 2, { jersey: 2 }), det(14.3, 'dig', 2, { hint: 'quiet', confidence: 0.2 }), det(15.2, 'attack', 2),
    ];
    const r = detectionReport(run, saved, players);
    expect(r.truth).toBe(4);
    expect(r.found).toBe(3);
    expect(r.theirs).toBe(2);
    expect(r.extra).toBe(1);
    expect(r.actions).toMatchObject({ n: 3, right: 2 });
    expect(r.actions.confusion).toEqual([['set read as attack', 1]]);
    expect(r.numbers).toEqual({ read: 2, right: 1 });
    expect(r.bySkill.find((s) => s.skill === 'attack')).toEqual({ skill: 'attack', n: 1, found: 0 });
    expect(r.byKind.find((k) => k.kind === 'quiet')).toEqual({ kind: 'quiet', n: 1, hits: 0 });
    expect(r.timing.medianAbs).toBeCloseTo(0.1);
  });
});
