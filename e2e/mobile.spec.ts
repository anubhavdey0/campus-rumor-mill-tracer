import { expect, playButton, test } from './fixtures';

test('the map and the Play button fit on the first screen, with no sideways scroll', async ({ page }) => {
  await page.goto('/');
  const viewport = page.viewportSize()!;
  const play = await playButton(page).boundingBox();
  expect(play).not.toBeNull();
  expect(play!.y + play!.height).toBeLessThanOrEqual(viewport.height);

  const canvas = await page.locator('#stage canvas').boundingBox();
  expect(canvas!.height).toBeGreaterThan(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
    0,
  );
});

test('tapping a student shows them under the map, with a way to their trace', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#stage canvas');
  const box = (await canvas.boundingBox())!;

  // Tap around the map until a student is picked.
  let picked = false;
  for (let y = 0.15; y <= 0.85 && !picked; y += 0.05) {
    for (let x = 0.1; x <= 0.9 && !picked; x += 0.05) {
      await page.touchscreen.tap(box.x + box.width * x, box.y + box.height * y);
      picked = (await page.getByRole('button', { name: 'Clear selection' }).count()) > 0;
    }
  }
  expect(picked).toBe(true);
  await page.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toBeInViewport();
});
