import { expect, test } from './fixtures';
import { PASSWORD } from '../setup';

test('wrong password is refused, the right one logs in', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Password').fill('not-it');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('.error')).toBeVisible();
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.goto('/teams');
  await expect(page.getByText('Testers Nord').first()).toBeVisible();
});

test('team page lists the roster', async ({ page, seed, login }) => {
  await login();
  await page.goto(`/teams/${seed.teamId}`);
  await expect(page.getByRole('heading', { name: /Testers Nord/ })).toBeVisible();
  for (const name of ['Kim Muster', 'Noa Beispiel']) await expect(page.getByText(name).first()).toBeVisible();
});

test('scouting report gives a game plan', async ({ page, seed, login }) => {
  await login();
  await page.goto(`/teams/${seed.teamId}/scouting`);
  const plan = page.locator('.scout-plan');
  await expect(plan).toContainText('How to play them');
  await expect(plan).toContainText('#5');
  await expect(page.getByRole('heading', { name: 'Attackers' })).toBeVisible();
  await page.getByRole('button', { name: 'Save as PDF / print' }).click();
  await expect(page.locator('.print-page')).toBeVisible();
});

test('match page shows the tags and the score', async ({ page, seed, login }) => {
  await login();
  await page.goto(`/m/${seed.matchId}`);
  await expect(page.getByText('League match').first()).toBeVisible();
  // 9 kills in 12 rallies, 3 attack errors and 2 opponent points: 9 : 5 in set 1.
  await expect(page.getByText(/^9\s*:\s*5$/).first()).toBeVisible();
});

test('stats page opens for the team', async ({ page, login }) => {
  await login();
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Testers Nord' })).toBeAttached();
  await expect(page.getByText('9–5 after 14 rallies').first()).toBeVisible();
});
