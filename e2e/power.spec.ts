/*
 * Power cords in the rack view: "Plug in everything" plugs the equipment into the rack's PDU / UPS, the loads show,
 * the cords can be undone, and the bill of materials counts them.
 */
import { expect, test } from '@playwright/test';
import { launch, newClient, tab } from './app';

test('plugging a rack in and counting its power cords', async () => {
  const a = await launch({ name: 'power' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Power', 'Small network + rack (up to 25 users)');
    await tab(page, 'View');
    await page.getByRole('button', { name: /^Racks/ }).click();
    await expect(page.getByText(/^Power cords \(0\)/)).toBeVisible();
    await page.getByRole('button', { name: 'Plug in everything' }).click();
    await expect(page.getByText(/^Power cords \([1-9]\d*\)/)).toBeVisible();
    await expect(page.getByText(/\d+ \/ \d+ W/).first()).toBeVisible();

    // The bill of materials counts them.
    await tab(page, 'Data');
    await page.locator('header').getByRole('button', { name: 'Bill of Materials' }).click();
    const bom = page.getByRole('dialog', { name: 'Bill of materials' });
    await expect(bom.getByText('Power cord C13–C14, 2 ft')).toBeVisible();
    await bom.getByRole('button', { name: 'Close' }).click();

    // Undo takes them out again.
    await page.keyboard.press('Control+Z');
    await tab(page, 'View');
    await page.getByRole('button', { name: /^Racks/ }).click();
    await expect(page.getByText(/^Power cords \(0\)/)).toBeVisible();
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
