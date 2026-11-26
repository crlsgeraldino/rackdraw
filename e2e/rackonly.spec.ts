/*
 * Patch panels in the rack only: turning "Patch panels on the diagram" off in the rack view hides them on the
 * diagram, where the cables through them become one line "via" the panel; turning it on brings them back.
 */
import { expect, test, type Page } from '@playwright/test';
import { launch, newClient, tab } from './app';

const toRacks = async (page: Page) => { await tab(page, 'View'); await page.getByRole('button', { name: /^Racks/ }).click(); };
const toDiagram = async (page: Page) => page.getByRole('button', { name: /Diagram/ }).first().click();
const shown = (page: Page) => page.locator('.react-flow__node-device:visible').count();

test('patch panels can live in the rack only', async () => {
  const a = await launch({ name: 'rackonly' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Panels', 'Small network + rack (up to 25 users)');
    const before = await shown(page);
    expect(await page.getByText(/^via /).count()).toBe(0);

    await toRacks(page);
    const toggle = page.getByRole('checkbox', { name: 'Patch panels on the diagram' });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await toDiagram(page);
    await expect.poll(() => shown(page)).toBeLessThan(before);
    await expect(page.getByText(/via .+/).first()).toBeVisible();

    await toRacks(page);
    await page.getByRole('checkbox', { name: 'Patch panels on the diagram' }).check();
    await toDiagram(page);
    await expect.poll(() => shown(page)).toBe(before);
    expect(await page.getByText(/^via /).count()).toBe(0);
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
