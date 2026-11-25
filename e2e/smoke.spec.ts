import { expect, test } from '@playwright/test';
import { launch } from './app';

test('the desktop app starts with no errors', async () => {
  const a = await launch({ name: 'smoke' });
  try {
    await expect(a.page.locator('header [role=tab]').first()).toBeVisible();
    const tabs = await a.page.locator('header [role=tab]').allTextContents();
    console.log('tabs:', tabs.join(' | '));
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
