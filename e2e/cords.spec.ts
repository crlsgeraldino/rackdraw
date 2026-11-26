/*
 * Rack view cords: a cord's middle handle dragged to a post dresses it there (kept with the cord); double-clicking
 * the handle puts it back to automatic.
 */
import { expect, test } from '@playwright/test';
import { launch, newClient, tab } from './app';

test('dressing a power cord by hand and back to automatic', async () => {
  const a = await launch({ name: 'cords' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Cords', 'Small network + rack (up to 25 users)');
    await tab(page, 'View');
    await page.getByRole('button', { name: /^Racks/ }).click();
    await page.getByRole('button', { name: 'Plug in everything' }).click();
    const rear = page.locator('div.rounded.bg-white.p-2.shadow-sm').nth(1);
    const handles = rear.locator('circle[r="3.5"]');
    await expect(handles.first()).toBeAttached();
    const byHand = rear.locator('circle[r="3.5"][opacity="1"]');
    await expect(byHand).toHaveCount(0);

    const h = handles.first();
    await h.scrollIntoViewIfNeeded();
    const hb = (await h.boundingBox())!;
    const sb = (await rear.locator('svg').first().boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + 30, hb.y + 4, { steps: 6 });
    await page.mouse.up();
    await expect(byHand).toHaveCount(1);

    // Double-click: automatic again.
    const set = (await byHand.boundingBox())!;
    await page.mouse.click(set.x + set.width / 2, set.y + set.height / 2);
    await page.mouse.click(set.x + set.width / 2, set.y + set.height / 2);
    await expect(byHand).toHaveCount(0);
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
