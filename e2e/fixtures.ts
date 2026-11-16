import { expect, test as base, type Locator, type Page } from '@playwright/test';

/**
 * Every test starts with the first-visit tips dismissed, and fails if the page
 * logs an error or warning.
 */
export const test = base.extend<{ consoleProblems: string[] }>({
  consoleProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
      });
      page.on('pageerror', (error) => problems.push(String(error)));
      await page.addInitScript(() => {
        try {
          localStorage.setItem('rumor-mill-intro-done', '1');
        } catch {
          // Storage can be blocked; the tips card then shows, which no test depends on.
        }
      });
      await use(problems);
      expect(problems, 'console errors or warnings').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The "12/26" counter next to the timeline. */
export function counter(page: Page): Locator {
  return page.locator('#stage').getByText(/^\d+\/\d+$/);
}

/** Reads the counter as [completed, total]. */
export async function progress(page: Page): Promise<[number, number]> {
  const [completed, total] = ((await counter(page).textContent()) ?? '').split('/').map(Number);
  return [completed, total];
}

/** Jumps the run to its end with the timeline slider. */
export async function finishRun(page: Page): Promise<void> {
  const timeline = page.getByRole('slider', { name: 'Timeline' });
  await timeline.focus();
  await timeline.press('End');
}

/** The Play/Pause button, whatever its current label. */
export function playButton(page: Page): Locator {
  return page.locator('button[aria-keyshortcuts="Space"]');
}
