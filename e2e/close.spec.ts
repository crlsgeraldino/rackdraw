/*
 * File → Close / Delete this client: a client saved in its own file just closes (the file stays); one without a file
 * can be deleted without saving a copy.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { launch, newClient, newFile } from './app';

const clients = (page: Page) => page.locator('header select').first().evaluate((s: HTMLSelectElement) => [...s.options].map((o) => o.text));
const fileMenu = async (page: Page) => {
  await page.locator('header button', { hasText: /^File$/ }).click();
  return page.getByRole('dialog', { name: 'File' });
};

test('a client without a file can be deleted without saving a copy', async () => {
  const a = await launch({ name: 'delete' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Throwaway');
    const before = fs.readdirSync(a.files).length;
    await (await fileMenu(page)).getByRole('button', { name: 'Delete this client…' }).click();
    const ask = page.getByRole('alertdialog', { name: /Delete "E2E Throwaway"/ });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Delete without a copy' }).click();
    await expect.poll(() => clients(page)).not.toContain('E2E Throwaway');
    expect(fs.readdirSync(a.files).length).toBe(before); // nothing was saved
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});

test('a client saved in a file just closes, and its file stays', async () => {
  const a = await launch({ name: 'closefile' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Saved');
    const before = new Set(fs.readdirSync(a.files));
    await page.keyboard.press('Control+S');
    const file = await newFile(a.files, before);
    await (await fileMenu(page)).getByRole('button', { name: 'Close this client…' }).click();
    const ask = page.getByRole('alertdialog', { name: /Close "E2E Saved"/ });
    await expect(ask).toContainText('stays where it is');
    await ask.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => clients(page)).not.toContain('E2E Saved');
    expect(fs.existsSync(file)).toBe(true);
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});

test('Cancel keeps the client', async () => {
  const a = await launch({ name: 'keep' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Keep');
    await (await fileMenu(page)).getByRole('button', { name: 'Delete this client…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    expect(await clients(page)).toContain('E2E Keep');
  } finally {
    await a.close();
  }
});
