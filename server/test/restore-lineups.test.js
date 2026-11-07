import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../src/restore-lineups.js';

const L = (order) => ({ order: [...order, ...Array(6 - order.length).fill(null)], libero: null, weServeFirst: false });

test('restore: missing second-side line-ups come from the newest backup that has them, only when the players fit', () => {
  const now = [{ id: 1, label: 'Practice', practice: JSON.stringify({ names: { a: 'Near', b: 'Far' }, sets: { 1: { a: [1, 2], b: [3, 4] }, 2: { a: [1, 3], b: [2, 4] }, 3: { a: [1], b: [9] } }, lineupsB: { 2: L([2, 4]) } }) }];
  const newest = [{ id: 1, practice: JSON.stringify({ sets: {}, lineupsB: { 1: L([3, 4]) } }) }];
  const older = [{ id: 1, practice: JSON.stringify({ sets: {}, lineupsB: { 1: L([4, 3]), 2: L([4, 2]), 3: L([5]) } }) }];
  const [t] = plan(now, [newest, older]);
  assert.deepEqual(t.add, { 1: L([3, 4]) }, 'set 1 from the newest; set 2 is there already; set 3 does not fit the sides');
  assert.equal(plan(now, []).length, 0);
});
