/*
 * Bill of Materials → what the job supplies: "Client has everything", then mark a line New. Only that line is quoted;
 * the rest is listed as already on site.
 */
import { expect, test } from '@playwright/test';
import { launch, newClient, tab } from './app';

test('a replacement job quotes only what is new', async () => {
  const a = await launch({ name: 'scope' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Refresh', 'Small network + rack (up to 25 users)');
    await tab(page, 'Data');
    await page.locator('header').getByRole('button', { name: 'Bill of Materials' }).click();
    const d = page.getByRole('dialog', { name: 'Bill of materials' });
    await d.getByRole('button', { name: 'Client has everything' }).click();
    await expect(d.getByRole('button', { name: /: new$/ })).toHaveCount(0);

    const line = d.getByRole('button', { name: /: client has it$/ }).first();
    const item = (await line.getAttribute('aria-label'))!.replace(/: client has it$/, '');
    await line.click();
    await expect(d.getByRole('button', { name: `${item}: new` })).toBeVisible();
    await expect(d.getByText(/lines? already on site, not quoted/)).toBeVisible();

    // Everything new again: nothing is left on site.
    await d.getByRole('button', { name: 'Everything is new' }).click();
    await expect(d.getByRole('button', { name: /: client has it$/ })).toHaveCount(0);
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
