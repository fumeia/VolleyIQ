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

test('practice line-up: only this side\'s players, any of them in the six, only liberos and middles as libero', async ({ page, login }) => {
  await login();
  const team = await (await page.request.post('/api/teams', { data: { name: `Lineup team ${Date.now()}` } })).json();
  const ids: Record<string, number> = {};
  for (const [name, number, role] of [['Nico Las', 2, 'OH'], ['Mat Eo', 9, 'S'], ['Hong Li', 17, 'L'], ['Mark Us', 6, 'MB'], ['Other Side', 11, 'OH']] as const) {
    ids[name] = (await (await page.request.post(`/api/teams/${team.id}/players`, { data: { name, number, role } })).json()).id;
  }
  const match = await (await page.request.post('/api/matches', { data: { label: 'Lineup test', team_id: team.id, mode: 'live' } })).json();
  await page.request.patch(`/api/matches/${match.id}`, { data: { practice: { names: { a: 'Near', b: 'Far' }, sets: { 1: { a: [ids['Other Side']], b: [ids['Nico Las'], ids['Mat Eo'], ids['Hong Li'], ids['Mark Us']], near: 'a' } } } } });
  await page.goto(`/m/${match.id}`);
  await page.locator('.practice-bar').getByRole('button', { name: /Line-up Far/ }).click();
  const sheet = page.locator('.sheet');
  // Only Far's players are offered; the near side's player is not.
  await expect(sheet.locator('.chips').first()).not.toContainText('Other');
  // The OH goes into position 1.
  await sheet.locator('.lineup-slot', { hasText: '1 · serves' }).click();
  await sheet.locator('.chips').first().getByRole('button', { name: /#2 Nico/ }).click();
  await expect(sheet.locator('.lineup-slot', { hasText: '1 · serves' })).toContainText('#2 Nico');
  // Libero choices: the libero and the middle only, no OH or setter.
  const libero = sheet.locator('.chips').nth(1);
  await expect(libero).toContainText('#17 Hong');
  await expect(libero).toContainText('#6 Mark');
  await expect(libero).not.toContainText('#9 Mat');
  await expect(libero).not.toContainText('#2 Nico');
});

test('practice match: after the near side serves, a far player gets Receive first', async ({ page, login }) => {
  await login();
  const team = await (await page.request.post('/api/teams', { data: { name: `Receive team ${Date.now()}` } })).json();
  const near = (await (await page.request.post(`/api/teams/${team.id}/players`, { data: { name: 'Near Server', number: 4, role: 'OH' } })).json()).id;
  const far = (await (await page.request.post(`/api/teams/${team.id}/players`, { data: { name: 'Far Passer', number: 8, role: 'OH' } })).json()).id;
  const match = await (await page.request.post('/api/matches', { data: { label: 'Receive test', team_id: team.id, mode: 'live' } })).json();
  await page.request.patch(`/api/matches/${match.id}`, { data: { practice: { names: { a: 'Near', b: 'Far' }, sets: { 1: { a: [near], b: [far] } } } } });
  await page.request.post(`/api/matches/${match.id}/events`, { data: { action: 'serve', player_id: near, side: 'a', set_no: 1 } });
  await page.goto(`/m/${match.id}`);
  await page.locator('.pad-side-b .jersey', { hasText: 'Far' }).click();
  await expect(page.locator('.pad-likely button').first()).toHaveText('Receive');
  // The same side again: what follows its own serve (a dig, a block, a free ball).
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.pad-side-a .jersey', { hasText: 'Near' }).click();
  await expect(page.locator('.pad-likely')).not.toContainText('Receive');
  // The receive row says so too.
  await expect(page.locator('.skill-row', { hasText: 'Receive' }).first()).toBeVisible();
});

test('practice match: blocked attack + block point is one point; off the block asks who touched it', async ({ page, login }) => {
  await login();
  const team = await (await page.request.post('/api/teams', { data: { name: `Block team ${Date.now()}` } })).json();
  const near = (await (await page.request.post(`/api/teams/${team.id}/players`, { data: { name: 'Ash Win', number: 3, role: 'OH' } })).json()).id;
  const far = (await (await page.request.post(`/api/teams/${team.id}/players`, { data: { name: 'Kon Stantin', number: 5, role: 'MB' } })).json()).id;
  const match = await (await page.request.post('/api/matches', { data: { label: 'Block test', team_id: team.id, mode: 'live' } })).json();
  await page.request.patch(`/api/matches/${match.id}`, { data: { practice: { names: { a: 'Near', b: 'Far' }, sets: { 1: { a: [near], b: [far] } } } } });
  await page.request.post(`/api/matches/${match.id}/events`, { data: { action: 'attack_blocked', player_id: near, side: 'a', set_no: 1, t: 10 } });
  await page.request.post(`/api/matches/${match.id}/events`, { data: { action: 'block_point', player_id: far, side: 'b', set_no: 1, t: 10.4 } });
  await page.goto(`/m/${match.id}`);
  await expect(page.locator('.practice-bar')).toContainText(/Near\s*0 : 1\s*Far/);
  // A kill off the block: who of Far touched it?
  await page.locator('.pad-side-a .jersey', { hasText: 'Ash' }).click();
  await page.locator('.skill-offblock').getByRole('button', { name: 'Kill' }).click();
  for (let i = 0; i < 2; i++) {
    const skip = page.getByRole('button', { name: /^Skip/ });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }
  const ask = page.getByRole('dialog', { name: 'Who touched it on the block' });
  await ask.getByRole('button', { name: /#5 Kon/ }).click();
  await expect(page.locator('.ws-content')).toContainText(/#5 Kon\s*Block touched out/);
  // One point for Near (the kill), none for the touch.
  await expect(page.locator('.practice-bar')).toContainText(/Near\s*1 : 1\s*Far/);
  // Marked fully tagged.
  await page.getByRole('button', { name: /^Events/ }).click();
  // Each tag shows whether it scores: the blocked attack +0 (counted with the block point), the block point +1.
  const rows = page.locator('.evlist li');
  await expect(rows.filter({ hasText: 'Attack Blocked' }).locator('.ev-pt')).toHaveText('+0');
  await expect(rows.filter({ hasText: 'Attack Blocked' }).locator('.ev-pt')).toHaveClass(/ev-pt-paired/);
  await expect(rows.filter({ hasText: 'Block Point' }).locator('.ev-pt')).toHaveText('+1');
  await page.getByRole('button', { name: 'Mark as fully tagged' }).click();
  await expect(page.locator('.final-box')).toContainText('Fully tagged');
  // After a serve of Near, Far's players come first on the tag pad (to tag the pass).
  await page.request.post(`/api/matches/${match.id}/events`, { data: { action: 'serve', player_id: near, side: 'a', set_no: 1, t: 60 } });
  await page.reload();
  await expect(page.locator('.pad-side').first()).toHaveClass(/pad-side-b/);
  // Far recycles off the block: still Far's ball.
  await page.request.post(`/api/matches/${match.id}/events`, { data: { action: 'attack', value: 3, player_id: far, side: 'b', set_no: 1, t: 62 } });
  await page.reload();
  await expect(page.locator('.pad-side').first()).toHaveClass(/pad-side-b/);
  // Far attacks in play: Near is next.
  await page.request.post(`/api/matches/${match.id}/events`, { data: { action: 'attack', player_id: far, side: 'b', set_no: 1, t: 64 } });
  await page.reload();
  await expect(page.locator('.pad-side').first()).toHaveClass(/pad-side-a/);
});

test('practice match analysis: the sides of each set, combinations, a player across sets; season leaves practice out', async ({ page, login }, info) => {
  await login();
  const team = await (await page.request.post('/api/teams', { data: { name: `Mix team ${Date.now()}` } })).json();
  const ids: number[] = [];
  for (const [n, name, role] of [[1, 'Ann Set', 'S'], [2, 'Bea Hit', 'OH'], [3, 'Cay Mid', 'MB'], [4, 'Dot Set', 'S'], [5, 'Eve Hit', 'OH'], [6, 'Fay Opp', 'OPP']] as const) {
    ids.push((await (await page.request.post(`/api/teams/${team.id}/players`, { data: { name, number: n, role } })).json()).id);
  }
  const [ann, bea, cay, dot, eve, fay] = ids;
  const match = await (await page.request.post('/api/matches', { data: { label: 'Mixed practice', team_id: team.id, mode: 'live' } })).json();
  await page.request.patch(`/api/matches/${match.id}`, { data: {
    practice: { names: { a: 'Near', b: 'Far' }, sets: { 1: { a: [ann, bea, cay], b: [dot, eve, fay] }, 2: { a: [ann, cay, eve], b: [dot, bea, fay] } },
      lineupsB: { 1: { order: [dot, eve, fay, null, null, null], weServeFirst: false } } },
    lineups: { 1: { order: [ann, bea, cay, null, null, null], weServeFirst: true } },
  } });
  let t = 0;
  const tag = (set: number, side: string, player: number, action: string) => page.request.post(`/api/matches/${match.id}/events`, { data: { action, player_id: player, side, set_no: set, t: t += 2 } });
  for (let i = 0; i < 4; i++) { await tag(1, 'a', ann, 'set'); await tag(1, 'a', bea, 'kill'); }
  await tag(1, 'b', dot, 'set'); await tag(1, 'b', eve, 'attack_error');
  for (let i = 0; i < 4; i++) { await tag(2, 'b', dot, 'set'); await tag(2, 'b', bea, 'attack_error'); }
  await tag(2, 'a', ann, 'set'); await tag(2, 'a', eve, 'kill');
  // A normal match too, so the season has something without the practice match.
  const real = await (await page.request.post('/api/matches', { data: { label: 'League game', team_id: team.id, mode: 'live' } })).json();
  await page.request.post(`/api/matches/${real.id}/events`, { data: { action: 'ace', player_id: cay, set_no: 1, t: 1 } });
  for (const t of [3, 6]) await page.request.post(`/api/matches/${real.id}/events`, { data: { action: 'kill', player_id: bea, set_no: 1, t } });

  await page.goto('/reports');
  await page.locator('select').first().selectOption({ label: team.name });
  await expect(page.getByText('Include practice matches (1)')).toBeVisible();
  await page.locator('select').nth(1).selectOption(String(match.id));
  await expect(page.locator('.practice-set').first()).toContainText("Ann's side");
  await expect(page.locator('.practice-set').first()).toContainText("Dot's side");
  // The "?" opens what the table shows.
  await page.getByRole('button', { name: 'What "Set by set" shows' }).click();
  await expect(page.locator('.help-text')).toContainText('whole side');
  await expect(page.locator('.practice-set').first().locator('.practice-set-score')).toHaveText('5 : 0');
  await page.screenshot({ path: info.outputPath('practice-sets.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Combinations' }).click();
  await expect(page.locator('.findings')).toContainText('Best setter and hitter: #1 Ann setting #2 Bea');
  await expect(page.locator('.practice-changes')).toContainText('#2 Bea');
  await expect(page.locator('.practice-changes')).toContainText('setter #1 Ann → #4 Dot');
  await expect(page.getByRole('button', { name: 'What "Setters" shows' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('practice-combos.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Players' }).click();
  await page.locator('.chips').getByRole('button', { name: '#2 Bea' }).click();
  await expect(page.locator('.practice-timeline li')).toHaveCount(2);
  await expect(page.locator('.practice-timeline li').nth(1)).toContainText('#4 Dot setting');
  await page.screenshot({ path: info.outputPath('practice-player.png'), fullPage: true });
  // Errors: per side, no "us" and "them".
  await page.locator('.stats-sections').getByRole('button', { name: 'Errors' }).click();
  await expect(page.locator('.practice-analysis')).toContainText('Where the points came from');
  await expect(page.locator('.practice-analysis')).toContainText("Set 1 · Ann's side");
  await expect(page.locator('.stats')).not.toContainText('rallies we lost');
  await page.screenshot({ path: info.outputPath('practice-errors.png'), fullPage: true });
  // Overview: the score of each set with the sides' names, no "us" and "them" tiles.
  await page.locator('.stats-sections').getByRole('button', { name: 'Overview' }).click();
  await expect(page.locator('.stats')).toContainText('Set 1 · score progression');
  await expect(page.locator('.stats')).toContainText("Ann's side 5 : 0 Dot's side");
  await expect(page.locator('.stats .kpis')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('practice-overview.png'), fullPage: true });
  // Rotations: each side's rotations per set.
  await page.locator('.stats-sections').getByRole('button', { name: 'Rotations' }).click();
  await expect(page.locator('.stats')).toContainText('Rotations per side');
  // Public player page: the practice matches can be switched on, and that stays for the visit.
  const token = (await (await page.request.post(`/api/teams/${team.id}/share`, { data: {} })).json()).share_token;
  await page.goto(`/s/t/${token}/p/${bea}`);
  const toggle = page.getByLabel(/Include practice matches \(1\)/);
  await expect(toggle).not.toBeChecked();
  // Matches against practice, side by side, also while practice is switched off.
  await expect(page.locator('.learning')).toContainText('In matches and in practice');
  await toggle.check();
  // With practice on: two matches with attacks, so a trend line.
  await expect(page.locator('.learning')).toContainText('Attack efficiency per match');
  await page.screenshot({ path: info.outputPath('player-page.png'), fullPage: true });
  await page.goto(`/s/t/${token}/stats`);
  await expect(page.getByLabel(/Include practice matches \(1\)/)).toBeChecked();
});

test('every set matches the official result: the Events tab offers "Mark as fully tagged"', async ({ page, login }) => {
  await login();
  const team = await (await page.request.post('/api/teams', { data: { name: `Official team ${Date.now()}` } })).json();
  const p = (await (await page.request.post(`/api/teams/${team.id}/players`, { data: { name: 'Oli Ver', number: 4, role: 'OH' } })).json()).id;
  const match = await (await page.request.post('/api/matches', { data: { label: 'League game', team_id: team.id, mode: 'live' } })).json();
  for (const t of [5, 9]) await page.request.post(`/api/matches/${match.id}/events`, { data: { action: 'kill', player_id: p, set_no: 1, t } });
  await page.route(`**/api/matches/${match.id}/official`, (r) => r.fulfill({ json: { linked: true, game: { result: '1:0' }, sets: [{ set: 1, us: 2, them: 0 }] } }));
  await page.goto(`/m/${match.id}`);
  await page.getByRole('button', { name: /^Events/ }).click();
  const box = page.locator('.official-check');
  await expect(box).toContainText('Every set matches the official score');
  await box.getByRole('button', { name: 'Mark as fully tagged' }).click();
  await expect(page.locator('.final-box')).toContainText('Fully tagged');
  await expect(box.getByRole('button', { name: 'Mark as fully tagged' })).toHaveCount(0);
});
