import { counter, expect, finishRun, playButton, progress, test } from './fixtures';

test('plays, pauses, and steps through a run', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Campus Rumor Mill Tracer');
  await expect(counter(page)).toHaveText(/^0\/\d+$/);

  await playButton(page).click();
  await expect(playButton(page)).toHaveText('Pause');
  await expect.poll(async () => (await progress(page))[0]).toBeGreaterThan(1);
  await playButton(page).click();
  await expect(playButton(page)).toHaveText('Resume');

  // Pausing lets the retelling in flight land first, so wait for the counter to settle.
  await expect
    .poll(async () => {
      const [before] = await progress(page);
      await page.waitForTimeout(600);
      const [after] = await progress(page);
      return before === after;
    })
    .toBe(true);
  const [paused] = await progress(page);
  await page.getByRole('button', { name: 'Step forward' }).click();
  await expect.poll(async () => (await progress(page))[0]).toBe(paused + 1);
  await page.getByRole('button', { name: 'Step back' }).click();
  await expect.poll(async () => (await progress(page))[0]).toBe(paused);

  await finishRun(page);
  await expect(page.getByText('The rumor has run its course.')).toBeVisible();
  await expect(playButton(page)).toHaveText('Replay');
});

test('keyboard shortcuts drive the map, but never the rest of the page', async ({ page }) => {
  await page.goto('/');
  await page.locator('h1').click();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await progress(page))[0]).toBe(3);

  await page.locator('#model h2').scrollIntoViewIfNeeded();
  await page.locator('#model h2').click();
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press(' ');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  await expect(playButton(page)).not.toHaveText('Pause');
});

test('each route shows its own data structure and goes into the link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#stage').getByText('Queue', { exact: true })).toBeVisible();

  await page.getByText('Whisper chain', { exact: true }).first().click();
  await expect(page.locator('#stage').getByText(/^Stack/)).toBeVisible();
  await expect(page).toHaveURL(/route=dfs/);

  await page.getByText('Trusted first', { exact: true }).first().click();
  await expect(page.locator('#stage').getByText('Priority queue')).toBeVisible();
  await expect(page).toHaveURL(/route=best/);
});

test('traces a student back to the source and finds the most believable route', async ({ page }) => {
  await page.goto('/');
  const source = ((await page.getByLabel('Starts with').locator('option:checked').textContent()) ?? '').trim();
  await finishRun(page);

  await page.getByRole('tab', { name: 'Trace' }).click();
  const names = await page
    .locator('datalist option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const target = names.find((name) => name !== source)!;
  await page.getByLabel('Student', { exact: true }).fill(target);

  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { name: target })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Most believable route' })).toBeVisible();
  await expect(panel.getByText(/The most believable route runs/)).toBeVisible();
  await panel.getByLabel('Show it on the map as a dashed line').check();
  await expect(panel.getByRole('button', { name: `Start the rumor with ${target}` })).toBeVisible();
});

test('the Versions tab lists every wording and spotlights its holders', async ({ page }) => {
  await page.goto('/?route=dfs&bend=60');
  await finishRun(page);
  await page.getByRole('tab', { name: 'Versions' }).click();
  const rows = page.getByRole('tabpanel').locator('button[aria-pressed]');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(3);
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Clear the selected version' })).toBeVisible();
});

test('a fact-checker sets students straight before the rumor arrives', async ({ page }) => {
  await page.goto('/');
  const checker = page.getByLabel('Fact-checker');
  await checker.selectOption({ index: 20 });
  await expect(page).toHaveURL(/checker=/);
  await expect(page.getByText('Heard the fact-checker first')).toBeVisible();
  await expect(page.getByLabel("Rumor's head start")).toBeVisible();

  await finishRun(page);
  const stats = page.locator('dl').first();
  await expect(stats.getByText('Set straight')).toBeVisible();
  const setStraight = Number(
    await stats.locator('div', { hasText: 'Set straight' }).locator('dd span').first().textContent(),
  );
  expect(setStraight).toBeGreaterThan(0);
});

test('the network view ranks spreaders, and cut friendships can be restored', async ({ page }) => {
  await page.goto('/?cut=3');
  await page.getByText('Network', { exact: true }).click();
  await expect(page.getByText(/Best starting points by broadcast/)).toBeVisible();
  await expect(page.getByText('Bridge: the only link to part of campus')).toBeVisible();

  await page.getByRole('button', { name: 'Restore 1 cut friendship' }).click();
  await expect(page).not.toHaveURL(/cut=/);
  await expect(page.getByRole('button', { name: /Restore/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: 'Fit the whole campus' })).toBeEnabled();
});

test('a shared link restores the whole setup', async ({ page }) => {
  await page.goto('/?campus=777&students=72&route=dfs&decay=30&checker=5&lead=4');
  await expect(page.getByLabel('Campus number')).toHaveValue('777');
  await expect(page.locator('input[name="algorithm"][value="dfs"]')).toBeChecked();
  await expect(page.getByLabel('Trust lost per hop', { exact: true })).toHaveValue('0.3');
  await expect(page.getByLabel('Students', { exact: true })).toHaveValue('72');
  await expect(page.getByLabel("Rumor's head start")).toHaveValue('4');
});

test('Back returns to the previous campus', async ({ page }) => {
  await page.goto('/');
  const campus = page.getByLabel('Campus number');
  const first = await campus.inputValue();
  await page.getByRole('button', { name: 'New campus' }).click();
  await expect(campus).not.toHaveValue(first);
  await page.goBack();
  await expect(campus).toHaveValue(first);

  await campus.fill('1234');
  await campus.press('Enter');
  await expect(page).toHaveURL(/campus=1234/);
});

test('custom rumors need a real sentence', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Rumor', { exact: true }).selectOption('custom');
  const box = page.getByLabel('What really happened');
  await box.fill('!!!!!!!!!!');
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  await box.fill('The exam at 3:30 in Room 204 might be postponed for 20 students.');
  await expect(box).toHaveAttribute('aria-invalid', 'false');
});

test('the comparison section races, reruns, and charts all three routes', async ({ page }) => {
  await page.goto('/');
  await page.locator('#routes').scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Same rumor, three routes' })).toBeVisible();

  await page.getByRole('button', { name: 'Start the race', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause race' })).toBeVisible();
  await expect(page.getByText(/Across 200 reruns with different dice/).first()).toBeVisible({ timeout: 20_000 });

  const chart = page.getByRole('slider', { name: /Students reached as trust lost per hop rises/ });
  await chart.focus();
  await chart.press('Home');
  await expect(chart).toHaveAttribute('aria-valuetext', /^0% trust lost per hop: Broadcast \d+ of \d+/);
});

test('the theme cycles through light, dark, and the system setting', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /^Theme:/ });
  await expect(toggle).toHaveAttribute('aria-label', /match your system/);
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', /match your system/);
});
