/*
 * Starts the real desktop app (electron/main.cjs over the built `out/` folder) for an end-to-end test:
 * - its data lives in a fresh temporary folder (never your real clients);
 * - native Save dialogs and downloads are answered with files in that folder, so tests run unattended;
 * - page errors, console errors and blocked scripts are collected, and a test fails if there are any.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface App {
  app: ElectronApplication;
  page: Page;
  /** The test's temporary folder: app data in `data/`, saved and downloaded files in `files/`. */
  dir: string;
  files: string;
  /** Errors seen so far (page errors, console errors, CSP violations). */
  errors: string[];
  /** Messages of the alert / confirm boxes shown so far (all answered OK). */
  messages: string[];
  close(): Promise<void>;
}

export function tempDir(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rackdraw-e2e-${name}-`));
  fs.mkdirSync(path.join(dir, 'files'));
  return dir;
}

/** Starts RackDraw. `dir` reuses an earlier run's folder (to test that data survives a restart). */
export async function launch(opts: { dir?: string; args?: string[]; name?: string } = {}): Promise<App> {
  const dir = opts.dir ?? tempDir(opts.name ?? 'run');
  const files = path.join(dir, 'files');
  const app = await electron.launch({
    args: [path.resolve('electron/main.cjs'), ...(opts.args ?? [])],
    env: { ...process.env, RACKDRAW_DATA_DIR: path.join(dir, 'data') } as Record<string, string>,
  });
  // Native dialogs can't be clicked by a test: Save goes to the files folder, questions get their default answer.
  await app.evaluate(({ dialog, session, shell }, folder) => {
    const base = (p?: string) => (p ?? 'file').split(/[\\/]/).pop() as string;
    type SaveOpts = { defaultPath?: string };
    dialog.showSaveDialog = (async (a: unknown, b?: SaveOpts) => {
      const o = (b ?? a) as SaveOpts;
      return { canceled: false, filePath: `${folder}\\${base(o?.defaultPath)}` };
    }) as typeof dialog.showSaveDialog;
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
    shell.openExternal = (async () => {}) as typeof shell.openExternal; // links don't open a browser
    session.defaultSession.on('will-download', (_e, item) => item.setSavePath(`${folder}\\${item.getFilename()}`));
  }, files);
  const page = await app.firstWindow();
  // Printing opens the system print dialog: counted instead.
  await page.addInitScript(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed++; }; });
  await page.evaluate(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed++; }; });
  const errors: string[] = [];
  const messages: string[] = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Download the React DevTools/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  // alert / confirm / prompt: accepted, so flows continue (tests that care answer them themselves first).
  page.on('dialog', (d) => { messages.push(d.message()); void d.accept().catch(() => {}); });
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.violatedDirective} ${e.blockedURI}`));
  });
  await expect(page.locator('header')).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
  return {
    app, page, dir, files, errors, messages,
    async close() {
      // A normal close (the app saves on close), so a restart sees the data.
      await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.close(); }).catch(() => {});
      await app.waitForEvent('close', { timeout: 30_000 }).catch(() => app.close());
    },
  };
}

/** Closes "What's new" and other first-run dialogs. */
export async function dismissWelcome(page: Page) {
  const open = () => page.locator('div.fixed.inset-0, [role=dialog]').count();
  for (let i = 0; i < 3 && (await open()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    // Some dialogs close only from their backdrop.
    if (await open()) { await page.mouse.click(4, 300); await page.waitForTimeout(150); }
  }
}

/** Opens a ribbon tab by its name ("Home", "Insert", …). */
export async function tab(page: Page, name: string) {
  await page.locator('header [role=tab]', { hasText: new RegExp(`^${name}$`) }).first().click();
}

/** Picks `file` in the next file chooser that `open` brings up. */
export async function chooseFile(page: Page, file: string, open: () => Promise<void>) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), open()]);
  await chooser.setFiles(file);
}

/** File → New client, from a built-in template (its name as shown) or blank. */
export async function newClient(page: Page, name: string, template?: string) {
  await page.locator('header button', { hasText: /^File$/ }).click();
  await page.getByRole('dialog', { name: 'File' }).getByRole('button', { name: 'New client…' }).click();
  const d = page.getByRole('dialog', { name: 'New client' });
  await d.locator('#nc-client-name').fill(name);
  if (template) await d.getByText(template, { exact: true }).click();
  await d.getByRole('button', { name: 'Create' }).click();
  await expect(d).toBeHidden();
  await dismissWelcome(page);
}

/** Waits for a file to appear in `folder` (other than `before`) and to stop growing; returns its path. */
export async function newFile(folder: string, before: Set<string>, timeout = 60_000): Promise<string> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const fresh = fs.readdirSync(folder).filter((f) => !before.has(f) && !/\.(crdownload|tmp)$/i.test(f));
    if (fresh.length) {
      const p = path.join(folder, fresh[0]);
      let size = -1;
      for (let i = 0; i < 50 && size !== fs.statSync(p).size; i++) { size = fs.statSync(p).size; await new Promise((r) => setTimeout(r, 200)); }
      return p;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no new file in ${folder} after ${timeout} ms`);
}

/** File → Export → `title` (as shown on its card); answers an options dialog if one opens; returns the saved file. */
export async function exportAs(a: App, title: string): Promise<string> {
  const before = new Set(fs.readdirSync(a.files));
  await a.page.locator('header button', { hasText: /^File$/ }).click();
  await a.page.getByRole('dialog', { name: 'File' }).getByRole('button', { name: title }).click();
  const ok = /^(Export|Save|Download|Create)/;
  const dlg = a.page.locator('[role=dialog]').filter({ has: a.page.getByRole('button', { name: ok }) }).first();
  if (await dlg.isVisible({ timeout: 1500 }).catch(() => false)) await dlg.getByRole('button', { name: ok }).first().click();
  const file = await newFile(a.files, before, 120_000);
  await a.page.waitForTimeout(500); // an export that writes several files (CSV) finishes the others
  return file;
}
