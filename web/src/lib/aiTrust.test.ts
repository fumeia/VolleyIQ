import { describe, expect, it } from 'vitest';
import { courtPosition, feedbackFor, nextTouch, planAnswer, trustFor } from './aiTrust';
import type { AiStats, AiTouch } from './api';

const stats = (over: Partial<AiStats> = {}): AiStats => ({
  contact: { n: 0, correct: 0, sureN: 0, sureCorrect: 0 },
  team: { n: 0, correct: 0, sureN: 0, sureCorrect: 0 },
  action: { n: 0, correct: 0, sureN: 0, sureCorrect: 0 },
  jersey: { n: 0, correct: 0, sureN: 0, sureCorrect: 0 },
  position: { n: 0, correct: 0, sureN: 0, sureCorrect: 0 },
  ...over,
});
const answer = (o: Partial<AiTouch> = {}): AiTouch => ({ i: 1, contact: 'yes', team: 'ours', action: 'set', jersey: null, position: 'unsure', confidence: 0.7, ourSide: 'near', ...o });
const ctx = { stats: stats(), action: 'dig' as const, hasPlayer: false, byNumber: (n: number) => (n === 7 ? 70 : null), atPosition: (p: number) => p * 10 };

describe('court position from the picture', () => {
  it('near half reads 4-3-2 / 5-6-1, far half is mirrored', () => {
    expect(courtPosition('front-left', 'near')).toBe(4);
    expect(courtPosition('back-right', 'near')).toBe(1);
    expect(courtPosition('front-left', 'far')).toBe(2);
    expect(courtPosition('back-right', 'far')).toBe(5);
    expect(courtPosition('back-middle', 'far')).toBe(6);
    expect(courtPosition('unsure', 'near')).toBeNull();
    expect(courtPosition('front-left', null)).toBeNull();
  });
});

describe('trust per field', () => {
  it('waits for enough answers, then turns off a weak field and relaxes a strong one', () => {
    expect(trustFor(stats({ action: { n: 10, correct: 2, sureN: 10, sureCorrect: 2 } }), 'action')).toMatchObject({ off: false, min: 0.6 });
    expect(trustFor(stats({ action: { n: 30, correct: 15, sureN: 30, sureCorrect: 15 } }), 'action').off).toBe(true);
    expect(trustFor(stats({ jersey: { n: 40, correct: 38, sureN: 40, sureCorrect: 38 } }), 'jersey').min).toBeCloseTo(0.45);
    expect(trustFor(null, 'position').min).toBe(0.75);
  });
});

describe('planAnswer', () => {
  it('fills the action and the player by number, else by court position when sure enough', () => {
    expect(planAnswer(answer({ jersey: 7 }), ctx)).toEqual({ side: 'us', action: 'set', player: { id: 70, via: 'jersey' } });
    expect(planAnswer(answer({ position: 'front-right', confidence: 0.8 }), ctx).player).toEqual({ id: 20, via: 'position' });
    expect(planAnswer(answer({ position: 'front-right', confidence: 0.7 }), ctx).player).toBeUndefined();
    expect(planAnswer(answer({ jersey: 7 }), { ...ctx, hasPlayer: true }).player).toBeUndefined();
  });
  it('a kill is already an attack; theirs and no-touch answers', () => {
    expect(planAnswer(answer({ action: 'attack' }), { ...ctx, action: 'kill' }).action).toBeUndefined();
    expect(planAnswer(answer({ team: 'theirs', jersey: 7 }), ctx)).toEqual({ side: 'them' });
    expect(planAnswer(answer({ contact: 'no' }), ctx)).toEqual({ drop: true });
    expect(planAnswer(answer({ contact: 'no', confidence: 0.4 }), ctx)).toEqual({});
  });
  it('a field the stats turned off is never applied', () => {
    const off = { ...ctx, stats: stats({ action: { n: 30, correct: 10, sureN: 30, sureCorrect: 10 } }) };
    expect(planAnswer(answer({ confidence: 0.99 }), off).action).toBeUndefined();
  });
});

describe('feedbackFor', () => {
  const saved = { kept: true, ours: true, action: 'assist' as const, playerId: 70, number: 7, positionPlayer: 20 };
  it('scores each answered field against what was saved', () => {
    expect(feedbackFor(answer({ jersey: 7 }), saved).map((f) => [f.field, f.correct])).toEqual([
      ['contact', true], ['team', true], ['action', true], ['jersey', true], ['position', false],
    ]);
  });
  it('a removed touch only says something about contact; the other team only about the team', () => {
    expect(feedbackFor(answer(), { ...saved, kept: false })).toEqual([{ field: 'contact', confidence: 0.7, correct: false }]);
    expect(feedbackFor(answer({ team: 'theirs' }), { ...saved, ours: false }).map((f) => f.field)).toEqual(['contact', 'team']);
  });
});

describe('nextTouch', () => {
  it('follows the usual order of a rally', () => {
    expect(nextTouch(null)).toEqual({ action: 'serve', sameTeam: true });
    expect(nextTouch('serve')).toEqual({ action: 'receive', sameTeam: false });
    expect(nextTouch('receive')).toEqual({ action: 'set', sameTeam: true });
    expect(nextTouch('assist')).toEqual({ action: 'attack', sameTeam: true });
    expect(nextTouch('kill')).toEqual({ action: 'dig', sameTeam: false });
    expect(nextTouch('block_touch')).toEqual({ action: 'dig', sameTeam: true });
  });
});
