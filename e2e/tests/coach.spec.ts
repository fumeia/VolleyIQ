import { expect, test } from './fixtures';
import { PASSWORD } from '../setup';
import type { Page } from '@playwright/test';

/** A live match of a team of its own (with a copy of the roster), so it does not show up in the other tests' team. */
async function liveMatch(page: Page, label: string) {
  const team = await (await page.request.post('/api/teams', { data: { name: `${label} team ${Date.now()}` } })).json();
  for (const [name, number] of [['Alex Probe', 1], ['Kim Muster', 5], ['Noa Beispiel', 7]] as const) {
    await page.request.post(`/api/teams/${team.id}/players`, { data: { name, number, role: 'OH' } });
  }
  return (await page.request.post('/api/matches', { data: { label, opponent: 'Sample VC', team_id: team.id, mode: 'live' } })).json();
}

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
  await expect(page.getByRole('heading', { name: 'Serve targets' })).toBeVisible();
  await expect(page.locator('.serve-best').first()).toContainText('#7');
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
  await page.locator('select').first().selectOption({ label: 'Testers Nord' });
  await expect(page.getByRole('option', { name: 'Testers Nord' })).toBeAttached();
  await expect(page.getByText('9–5 after 14 rallies').first()).toBeVisible();
});

test('match simulator gives a win chance and what helps most', async ({ page, seed, login }) => {
  await login();
  await page.goto(`/simulate?us=${seed.teamId}`);
  await expect(page.locator('.sim-team').first()).toContainText('rallies');
  await page.getByRole('button', { name: 'Simulate the match' }).click();
  await expect(page.locator('.sim-kpis')).toContainText('Match');
  await expect(page.locator('.sim-kpis b').first()).toHaveText(/^\d+%$/);
  await expect(page.getByRole('heading', { name: 'What helps most' })).toBeVisible();
});

test('time-out card sums up the set', async ({ page, seed, login }) => {
  await login();
  await page.goto(`/m/${seed.matchId}`);
  await page.getByRole('button', { name: 'Time-out' }).click();
  const card = page.getByRole('dialog', { name: 'Time-out' });
  await expect(card).toContainText('set 1 · 9 : 5');
  await expect(card).toContainText('Side-out');
  await expect(card.locator('.timeout-points li').first()).toBeVisible();
});

test('live tagging pauses and catches up the score', async ({ page, login }) => {
  await login();
  const match = await liveMatch(page, 'Live test');
  for (const action of ['kill', 'opp_point']) await page.request.post(`/api/matches/${match.id}/events`, { data: { action, set_no: 1 } });
  await page.goto(`/m/${match.id}`);
  await page.getByRole('button', { name: 'Pause tagging' }).click();
  await expect(page.locator('.paused-card')).toContainText('1 : 1');
  await page.reload();
  await expect(page.locator('.paused-card')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  const sheet = page.getByRole('dialog', { name: 'Resume tagging' });
  await sheet.getByLabel('Our points').fill('6');
  await sheet.getByLabel('Their points').fill('4');
  await sheet.getByRole('button', { name: 'Them', exact: true }).click();
  await sheet.getByRole('button', { name: 'Resume at 6 : 4' }).click();
  await expect(page.locator('.scorebox .score')).toHaveText(/6\s*:\s*4/);
  await expect(page.locator('.paused-card')).toHaveCount(0);
  // The untagged points are saved: still 6 : 4 after a reload.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.scorebox .score')).toHaveText(/6\s*:\s*4/);
});

test('voice tagging turns a spoken rally into tags', async ({ page, login }) => {
  await login();
  // A stand-in for the browser's speech recognition: window.say(text) "hears" a phrase.
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = ''; continuous = false; interimResults = false;
      onresult: ((e: unknown) => void) | null = null; onerror = null; onend = null;
      start() { (window as unknown as { say: (t: string) => void }).say = (t: string) => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] }); }
      stop() {} abort() {}
    }
    Object.assign(window, { webkitSpeechRecognition: FakeRecognition, SpeechRecognition: FakeRecognition });
  });
  const match = await liveMatch(page, 'Voice test');
  await page.goto(`/m/${match.id}`);
  await page.getByRole('button', { name: 'Voice tagging' }).click();
  await expect(page.locator('.voice-dot.on')).toBeVisible();
  await page.evaluate(() => (window as unknown as { say: (t: string) => void }).say('7 pass 2, 1 set, 5 attack, our point'));
  await expect(page.locator('.voice-now')).toContainText('#5 Kill');
  await expect(page.locator('.scorebox .score')).toHaveText(/1\s*:\s*0/);
  await page.evaluate(() => (window as unknown as { say: (t: string) => void }).say('Punkt Gegner'));
  await expect(page.locator('.scorebox .score')).toHaveText(/1\s*:\s*1/);
  await page.evaluate(() => (window as unknown as { say: (t: string) => void }).say('undo'));
  await expect(page.locator('.scorebox .score')).toHaveText(/1\s*:\s*0/);
  await page.getByRole('button', { name: 'Events' }).click();
  for (const t of [/#7 Noa\s*Receive 2/, /#1 Alex\s*Set/, /#5 Kim\s*Kill/]) await expect(page.locator('.ws-content')).toContainText(t);
});

test('voice tagging along a video in landscape gives the video the screen', async ({ page, seed, login }) => {
  await login();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => {
    class FakeRecognition { lang = ''; continuous = false; interimResults = false; onresult = null; onerror = null; onend = null; start() {} stop() {} abort() {} }
    Object.assign(window, { webkitSpeechRecognition: FakeRecognition, SpeechRecognition: FakeRecognition });
  });
  await page.goto(`/m/${seed.matchId}`);
  await page.getByRole('button', { name: 'Voice tagging' }).click();
  await expect(page.locator('.voice-bar')).toBeVisible();
  await expect(page.locator('.ws-panel')).toBeHidden();
  await expect(page.locator('.ws-head')).toBeHidden();
  await expect(page.locator('.voice-score')).toHaveText(/S1 \d+:\d+/);
  // The video takes the height (all but the timeline and the voice strip), at 16:9.
  const box = await page.locator('.video-box').boundingBox();
  expect(box!.height).toBeGreaterThan(280);
  expect(Math.abs(box!.width / box!.height - 16 / 9)).toBeLessThan(0.05);
  // The panel comes back on request, and voice keeps listening.
  await page.locator('.voice-bar').getByRole('button', { name: 'Panel' }).click();
  await expect(page.locator('.ws-panel')).toBeVisible();
  await expect(page.locator('.ws-head')).toBeVisible();
  await expect(page.locator('.voice-dot.on')).toBeVisible();
});

test('a tip kill and a kill off the block on the tag pad', async ({ page, login }) => {
  await login();
  const match = await liveMatch(page, 'Tip test');
  await page.goto(`/m/${match.id}`);
  await page.locator('.jersey', { hasText: 'Kim' }).click();
  await page.locator('.skill-tip').getByRole('button', { name: 'Kill' }).click();
  // Skip the court spots (where from, where it landed) if they are asked.
  for (let i = 0; i < 2; i++) {
    const skip = page.getByRole('button', { name: /^Skip/ });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }
  await expect(page.locator('.scorebox .score')).toHaveText(/1\s*:\s*0/);
  await expect(page.locator('.ws-content')).toContainText(/#5 Kim\s*Tip kill/);
  // Off the opponent's block: a kill too.
  await page.locator('.jersey', { hasText: 'Noa' }).click();
  await page.locator('.skill-offblock').getByRole('button', { name: 'Kill' }).click();
  for (let i = 0; i < 2; i++) {
    const skip = page.getByRole('button', { name: /^Skip/ });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }
  await expect(page.locator('.scorebox .score')).toHaveText(/2\s*:\s*0/);
  await expect(page.locator('.ws-content')).toContainText(/#7 Noa\s*Kill off the block/);
});

test('practice match: both sides from our roster, points for the right side', async ({ page, login }) => {
  await login();
  const team = await (await page.request.post('/api/teams', { data: { name: `Practice team ${Date.now()}` } })).json();
  for (const [name, number] of [['Alex Probe', 1], ['Kim Muster', 5], ['Noa Beispiel', 7], ['Jo Test', 9]] as const) {
    await page.request.post(`/api/teams/${team.id}/players`, { data: { name, number, role: 'OH' } });
  }
  await page.goto('/new?mode=live');
  await page.locator('form select').first().selectOption({ label: team.name });
  await page.getByLabel(/Practice match/).check();
  await page.getByRole('button', { name: /Create|Start/ }).click();
  // The sides of set 1 are asked right away: Alex and Kim near, Noa and Jo far.
  const sheet = page.getByRole('dialog', { name: 'Sides for this set' });
  const row = (n: string) => sheet.locator('.practice-row', { hasText: n });
  for (const n of ['Alex', 'Kim']) await row(n).getByRole('radio', { name: 'Near' }).click();
  for (const n of ['Noa', 'Jo']) await row(n).getByRole('radio', { name: 'Far' }).click();
  await sheet.getByRole('button', { name: /Save the sides/ }).click();
  await expect(page.locator('.pad-side-a')).toContainText('Kim');
  await expect(page.locator('.pad-side-b')).toContainText('Noa');
  // Each side has its own line-up for the rotations.
  await page.locator('.practice-bar').getByRole('button', { name: /Line-up Far/ }).click();
  await expect(page.locator('.sheet-head')).toContainText('Line-up Far');
  await expect(page.getByRole('button', { name: 'Far serves' })).toBeVisible();
  await page.locator('.sheet-head').getByRole('button').click();
  // Noa (far side) kills: a point for Far.
  await page.locator('.pad-side-b .jersey', { hasText: 'Noa' }).click();
  await page.locator('.skill-row', { hasText: 'Attack' }).first().getByRole('button', { name: /Kill/ }).click();
  for (let i = 0; i < 2; i++) {
    const skip = page.getByRole('button', { name: /^Skip/ });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }
  await expect(page.locator('.practice-bar')).toContainText(/Near\s*0 : 1\s*Far/);
  // A point for Near without a tag of the rally.
  await page.getByRole('button', { name: 'Point Near' }).click();
  await expect(page.locator('.practice-bar')).toContainText(/Near\s*1 : 1\s*Far/);
  // Saved: the same after a reload.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.practice-bar')).toContainText(/Near\s*1 : 1\s*Far/);
});

test('practice match: far side tapped as seen, saved from its own half', async ({ page, login }) => {
  await login();
  const team = await (await page.request.post('/api/teams', { data: { name: `Practice court ${Date.now()}` } })).json();
  const ids: number[] = [];
  for (const [name, number] of [['Alex Probe', 1], ['Noa Beispiel', 7]] as const) {
    ids.push((await (await page.request.post(`/api/teams/${team.id}/players`, { data: { name, number, role: 'OH' } })).json()).id);
  }
  const match = await (await page.request.post('/api/matches', { data: { label: 'Court test', team_id: team.id, mode: 'live' } })).json();
  // Blue (Alex) on the near half, White (Noa) on the far half.
  await page.request.patch(`/api/matches/${match.id}`, { data: { practice: { names: { a: 'Blue', b: 'White' }, sets: { 1: { a: [ids[0]], b: [ids[1]], near: 'a' } } } } });
  await page.goto(`/m/${match.id}`);
  await page.locator('.pad-side-b .jersey', { hasText: 'Noa' }).click();
  await page.locator('.skill-row', { hasText: 'Attack' }).first().getByRole('button', { name: /Kill/ }).click();
  const court = page.locator('.court-svg').first();
  // Drawn as seen: Blue below, White above.
  await expect(court).toContainText('WHITE');
  const box = (await court.boundingBox())!;
  // Hit from the far (upper) half, near the net; landed in the near (lower) half.
  await court.click({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
  await court.click({ position: { x: box.width * 0.6, y: box.height * 0.75 } });
  await expect(page.locator('.practice-bar')).toContainText(/Blue\s*0 : 1\s*White/);
  await page.waitForTimeout(500);
  const ev = (await (await page.request.get(`/api/matches/${match.id}`)).json()).events[0];
  // Saved from White's own half (y 0..9), going to the other half (y 9..18).
  expect(ev.side).toBe('b');
  expect(ev.fy).toBeLessThan(9);
  expect(ev.y).toBeGreaterThan(9);
});
