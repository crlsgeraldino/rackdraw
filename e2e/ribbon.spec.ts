/*
 * Clicks every button on every ribbon tab (with nothing selected, then with everything selected) and checks that the
 * app never shows its error screen and logs no errors. Dialogs that open are closed again with Escape.
 */
import { expect, test, type Page } from '@playwright/test';
import { launch, newClient, tab } from './app';

/** Buttons that leave the editor or change the window, not worth a click in a sweep. */
const SKIP = /Delete|Present|drawing alone|Full screen|Collapse ribbon|Close/i;

/** Dialogs that didn't close with Escape (reported, since users expect Escape to close a dialog). */
const noEscape = new Set<string>();

const overlay = (page: Page) => page.locator('div.fixed.inset-0, [role=dialog], [role=menu]');

async function closeDialogs(page: Page, what: string) {
  if (!(await overlay(page).count())) return;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (!(await overlay(page).count())) return;
  noEscape.add(what);
  // Click the dimmed backdrop's corner (closes most dialogs), then try their Close / Cancel buttons.
  for (let i = 0; i < 3 && (await overlay(page).count()); i++) {
    await page.mouse.click(4, 300);
    await page.waitForTimeout(150);
    for (const d of await page.locator('[role=dialog]').all()) {
      const btn = d.locator('button', { hasText: /^(Cancel|Close|Done|OK|Back|×|✕)$/ }).first();
      if (await btn.isVisible().catch(() => false)) await btn.click({ timeout: 2000 }).catch(() => {});
    }
    await page.keyboard.press('Escape');
  }
}

async function crashed(page: Page) {
  return page.getByText('Something went wrong').isVisible().catch(() => false);
}

async function sweep(page: Page, label: string) {
  const tabs = (await page.locator('header [role=tab]').allTextContents()).map((t) => t.trim());
  const report: string[] = [];
  let clicked = 0;
  for (const name of tabs) {
    await tab(page, name);
    const count = await page.locator('header .ribbon-body button').count();
    for (let i = 0; i < count; i++) {
      await tab(page, name);
      const b = page.locator('header .ribbon-body button').nth(i);
      if (!(await b.isVisible().catch(() => false)) || (await b.isDisabled().catch(() => true))) continue;
      const what = ((await b.getAttribute('aria-label')) || (await b.getAttribute('title')) || (await b.textContent()) || '').trim().slice(0, 40);
      if (SKIP.test(what)) continue;
      if (process.env.E2E_VERBOSE) console.log(`click ${name} › ${what}`);
      await b.click({ timeout: 5000 }).catch((e) => report.push(`${name} › ${what}: could not click (${String(e).slice(0, 80)})`));
      clicked++;
      await page.waitForTimeout(200);
      if (await crashed(page)) {
        report.push(`${name} › ${what}: error screen`);
        await page.getByRole('button', { name: /Try again/ }).click().catch(() => {});
      }
      await closeDialogs(page, `${name} › ${what}`);
    }
  }
  console.log(`${label}: clicked ${clicked} buttons`);
  return report;
}

test('every ribbon button works, with and without a selection', async () => {
  const a = await launch({ name: 'ribbon' });
  try {
    const { page } = a;
    await closeDialogs(page, 'start');
    // A realistic client: two pages, racks, cables, VLANs.
    await newClient(page, 'E2E Sweep', 'Small network + rack (up to 25 users)');
    page.on('filechooser', () => {}); // a file picker opened by a button is simply left (nothing chosen)
    const problems = await sweep(page, 'nothing selected');
    // Select everything on the page, then sweep again (Arrange, Shape and format buttons act on the selection).
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Control+A');
    problems.push(...(await sweep(page, 'all selected')));
    expect(problems).toEqual([]);
    expect([...noEscape], "dialogs that Escape didn't close").toEqual([]);
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
