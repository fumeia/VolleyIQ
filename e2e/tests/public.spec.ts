import { expect, test } from './fixtures';

test('public overview shows the team; only a live match shows a live score', async ({ page, seed, login }) => {
  await page.goto(`/s/t/${seed.share}`);
  await expect(page.getByText('Testers Nord').first()).toBeVisible();
  // The seeded match is tagged from a video a moment ago: not live.
  await expect(page.locator('.public-sub').first()).toBeVisible();
  await expect(page.locator('.live-sets')).toHaveCount(0);
  // A match created as live, with tags coming in, is.
  await login();
  const live = await (await page.request.post('/api/matches', { data: { label: 'Live now', opponent: 'Sample VC', team_id: seed.teamId, mode: 'live' } })).json();
  for (const action of ['kill', 'kill', 'opp_point']) await page.request.post(`/api/matches/${live.id}/events`, { data: { action, set_no: 1 } });
  await page.reload();
  await expect(page.locator('.live-sets')).toBeVisible();
  await expect(page.locator('.live-score')).toContainText('2 : 1');
  await page.request.delete(`/api/matches/${live.id}`);
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

test('replays: the chosen filters stay after going to another tab and back', async ({ page, seed }) => {
  await page.goto(`/s/t/${seed.share}/replays`);
  const skills = page.locator('.replay-filters .chips .chip');
  const pick = skills.nth(1);
  const name = (await pick.textContent())!;
  await pick.click();
  await page.locator('.replay-result').getByRole('button', { name: 'Points' }).click();
  await page.locator('.public-nav').getByRole('link', { name: 'Overview' }).click();
  await expect(page.locator('.replay-filters')).toHaveCount(0);
  await page.locator('.public-nav').getByRole('link', { name: 'Replays' }).click();
  await expect(page.locator('.replay-filters .chips .chip.on')).toHaveText(name);
  await expect(page.locator('.replay-result button.on')).toHaveText('Points');
});

test('stats topics show their main charts first, the rest behind "More charts"', async ({ page, seed }) => {
  await page.goto(`/s/t/${seed.share}/stats`);
  await page.locator('.stats-sections').getByRole('button', { name: 'Attack' }).click();
  await expect(page.getByText('Attackers', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Efficiency by where the attack was hit from/)).toHaveCount(0);
  await page.getByRole('button', { name: /More charts/ }).click();
  await expect(page.getByText(/Efficiency by where the attack was hit from/).first()).toBeVisible();
  await page.getByRole('button', { name: /Fewer charts/ }).click();
  await expect(page.getByText(/Efficiency by where the attack was hit from/)).toHaveCount(0);
});
