/*
 * Design → Borders & Titles and device outlines in the real app: every border design draws on the page with the page
 * name and page number, the PDF report is made with one, and Home → Line puts an outline round a device.
 * With E2E_SHOTS=1 a screenshot of each design is kept in test-results/ (for a visual check).
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { exportAs, launch, newClient, tab } from './app';

const DESIGNS = ['Simple frame', 'Title banner', 'Classic', 'Title strip', 'Corners', 'Side band', 'Underlined', 'Footer band', 'Header & footer', 'Tab', 'Rounded', 'Modern'];
const TITLED = DESIGNS.slice(1);

test('every border design draws on the page, and the PDF is made with one', async () => {
  const a = await launch({ name: 'borders' });
  try {
    const { page } = a;
    // A small laptop screen: the gallery must still reach its options (it scrolls).
    await a.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(1100, 640); });
    await newClient(page, 'E2E Borders', 'Small network + rack (up to 25 users)');
    const pageName = (await page.locator('.react-flow__pane').count()) ? await page.getByRole('textbox', { name: /Page name/ }).inputValue().catch(() => '') : '';
    for (const name of DESIGNS) {
      await tab(page, 'Design');
      await page.getByRole('button', { name: 'Borders & Titles' }).click();
      await page.getByRole('button', { name: `Border: ${name}` }).click();
      const svg = page.locator('.nc-page-sheet svg').first();
      await expect(svg).toBeVisible();
      if (TITLED.includes(name)) {
        const words = await svg.locator('text').allTextContents();
        expect(words.join(' | '), name).toMatch(/\b1 of \d/);
        expect(words.join(' | '), name).toContain('E2E Borders');
        if (pageName) expect(words.join(' | '), name).toContain(pageName);
      }
      if (process.env.E2E_SHOTS) {
        // Zoom out until the whole page sheet (and so the border) is in view.
        const pane = page.locator('.react-flow__pane');
        const box = await pane.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(80); }
        }
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join('test-results', 'borders', `${name.replace(/[^a-z]+/gi, '-')}.png`) });
      }
    }
    const pdf = await exportAs(a, 'PDF report');
    expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
    // Turning the page number off removes it from the page.
    await tab(page, 'Design');
    await page.getByRole('button', { name: 'Borders & Titles' }).click();
    await page.getByLabel('Page number').uncheck();
    await page.keyboard.press('Escape');
    await expect(page.locator('.nc-page-sheet svg text', { hasText: /Page 1 of/ })).toHaveCount(0);
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});

test('Home → Line puts an outline round a device, No line removes it', async () => {
  const a = await launch({ name: 'outline' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Outline', 'Small network + rack (up to 25 users)');
    const device = page.locator('.react-flow__node-device').first();
    await device.click();
    await tab(page, 'Home');
    await page.getByRole('button', { name: /^Line ▾/ }).click();
    await page.getByRole('button', { name: '#dc2626' }).first().click().catch(async () => { await page.locator('[aria-label^="#"]').first().click(); });
    const outline = device.locator('div.pointer-events-none.absolute[style*="border:"]');
    await expect(outline).toHaveCount(1);
    if (process.env.E2E_SHOTS) await device.screenshot({ path: path.join('test-results', 'borders', 'device-outline.png') });
    await page.getByRole('button', { name: /^Line ▾/ }).click();
    await page.getByRole('button', { name: 'No line' }).click();
    await expect(outline).toHaveCount(0);
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
