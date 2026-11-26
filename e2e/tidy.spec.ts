/** Design → Tidy Diagram and Device Look in the app: one click lays the page out, one Ctrl+Z puts it all back. */
import { expect, test } from '@playwright/test';
import { launch, newClient, tab } from './app';

const where = (page: import('@playwright/test').Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((n) => `${n.dataset.id}@${n.style.transform}`).sort().join('|'));

test('Tidy Diagram lays the page out as symbols, and undoes in one step', async () => {
  const a = await launch({ name: 'tidy' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Tidy', 'Small network + rack (up to 25 users)');
    await page.waitForTimeout(800);
    const before = await where(page);
    await tab(page, 'Design');
    await page.getByRole('button', { name: 'Tidy Diagram' }).click();
    await page.getByRole('button', { name: 'Tidy', exact: true }).click();
    await expect(page.getByText(/Arranged \d+ devices/)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    // Front-panel devices are now drawn as symbols, and the page changed.
    await expect(page.locator('.react-flow__node img[src^="data:image/svg+xml"]').first()).toBeVisible();
    expect(await where(page)).not.toBe(before);
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect.poll(() => where(page)).toBe(before);
    // Device Look on its own.
    await page.getByRole('button', { name: 'Device Look' }).click();
    await page.getByRole('button', { name: /^Icons/ }).click();
    await expect(page.locator('.react-flow__node img[src^="data:image/svg+xml"]').first()).toBeVisible();
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
