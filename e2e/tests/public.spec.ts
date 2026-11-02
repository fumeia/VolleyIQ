import { expect, test } from './fixtures';

test('public overview shows the team and the live score', async ({ page, seed }) => {
  await page.goto(`/s/t/${seed.share}`);
  await expect(page.getByText('Testers Nord').first()).toBeVisible();
  // The tags were made a moment ago: the match counts as live.
  await expect(page.locator('.live-sets')).toBeVisible();
  await expect(page.locator('.live-score')).toContainText('9 : 5');
});

test('public tabs open', async ({ page, seed }) => {
  await page.goto(`/s/t/${seed.share}`);
  for (const tab of ['Stats', 'Trends', 'Players', 'Overview']) {
    await page.locator('.public-nav').getByText(tab, { exact: true }).click();
    await expect(page.locator('.public-nav .tab.on')).toHaveText(tab);
  }
});

test('the public page switches to German and back', async ({ page, seed }) => {
  await page.goto(`/s/t/${seed.share}`);
  await page.locator('.lang-switch').getByRole('button', { name: 'DE' }).click();
  await expect(page.locator('.public-nav')).toContainText('Übersicht');
  await page.locator('.lang-switch').getByRole('button', { name: 'EN' }).click();
  await expect(page.locator('.public-nav')).toContainText('Overview');
});

test('a teammate makes a playlist with their shirt number', async ({ page, seed }, info) => {
  const title = `Best passes ${info.project.name}`;
  await page.goto(`/s/t/${seed.share}/replays`);
  await page.locator('.jersey-in').fill('7');
  await page.locator('.my-playlists').getByRole('button', { name: 'OK' }).click();
  const answers = [title, true];
  page.on('dialog', (d) => { const a = answers.shift(); void (d.type() === 'prompt' ? d.accept(String(a)) : d.accept()); });
  await page.getByRole('button', { name: /New playlist/ }).click();
  await expect(page.locator('.replay-playlists .chip', { hasText: title })).toContainText('#7');
  // Others see it too (it was made public).
  await page.reload();
  await expect(page.locator('.replay-playlists .chip', { hasText: title })).toBeVisible();
});

test('a wrong public link says so', async ({ page }) => {
  await page.goto('/s/t/not-a-real-token');
  await expect(page.getByText(/invalid or was revoked/).first()).toBeVisible();
});
