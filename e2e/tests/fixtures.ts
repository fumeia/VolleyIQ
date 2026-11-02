import { test as base, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { PASSWORD, STATE } from '../setup';

export interface Seed { teamId: number; matchId: number; share: string }

/**
 * Every test: the seeded ids, no first-visit tours, YouTube kept out (tests run offline),
 * and the test fails on any uncaught error in the page.
 */
export const test = base.extend<{ seed: Seed; errors: string[]; login: () => Promise<void> }>({
  seed: async ({}, use) => { await use(JSON.parse(fs.readFileSync(STATE, 'utf8'))); },
  errors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      for (const k of ['team', 'player', 'match', 'stats', 'coach', 'app']) localStorage.setItem(`viq:tour:${k}`, '1');
      // English to start with (the language switch test changes it; switching reloads the page).
      if (!sessionStorage.getItem('e2e')) { localStorage.setItem('viq:lang', 'en'); sessionStorage.setItem('e2e', '1'); }
    });
    await page.route(/youtube\.com|ytimg\.com|googlevideo\.com/, (r) => r.abort());
    await use(errors);
    expect(errors, 'errors in the page').toEqual([]);
  }, { auto: true }],
  login: async ({ page }, use) => {
    await use(async () => {
      const r = await page.request.post('/api/login', { data: { password: PASSWORD } });
      expect(r.ok()).toBeTruthy();
    });
  },
});

export { expect };
export type { Page };
