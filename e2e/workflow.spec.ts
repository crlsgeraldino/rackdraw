/*
 * The everyday path with a realistic client: create it from a template, save it, close RackDraw, start it again,
 * open the file, and export it in every format (each checked to be a real file of that kind).
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { exportAs, launch, newClient, newFile } from './app';

const TEMPLATE = 'Small network + rack (up to 25 users)';

const nodeCount = (page: Page) => page.locator('.react-flow__node').count();
/** The client open now (the client picker in the title bar). */
const current = (page: Page) => page.locator('header select').first().evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex]?.text ?? '');

test('a client survives save, restart and reopening its file', async () => {
  const a = await launch({ name: 'roundtrip' });
  let file = '';
  let nodes = 0;
  try {
    await newClient(a.page, 'E2E Office', TEMPLATE);
    nodes = await nodeCount(a.page);
    expect(nodes).toBeGreaterThan(10);
    const before = new Set(fs.readdirSync(a.files));
    await a.page.keyboard.press('Control+S');
    file = await newFile(a.files, before);
    expect(path.basename(file)).toMatch(/^E2E.Office\.rackdraw$/);
    expect(fs.readFileSync(file).subarray(0, 2).toString()).toBe('PK');
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }

  // Started again: the workspace still has the client.
  const b = await launch({ dir: a.dir });
  try {
    await expect.poll(() => current(b.page)).toBe('E2E Office');
    expect(await nodeCount(b.page)).toBe(nodes);
    expect(b.errors).toEqual([]);
  } finally {
    await b.close();
  }

  // Opened from its file (double-click in Explorer) on a fresh computer: the same drawing.
  const c = await launch({ name: 'reopen', args: [file] });
  try {
    await expect.poll(() => current(c.page)).toBe('E2E Office');
    await expect.poll(() => nodeCount(c.page)).toBe(nodes);
    expect(c.errors).toEqual([]);
  } finally {
    await c.close();
  }
});

/** What each export must look like: its first bytes, or the parts inside its ZIP. */
const EXPORTS: { title: string; ext: RegExp; check: (b: Buffer) => void }[] = [
  { title: 'Visio drawing (.vsdx)', ext: /\.vsdx$/, check: (b) => { expect(b.subarray(0, 2).toString()).toBe('PK'); expect(b.includes('visio/pages/page1.xml')).toBe(true); } },
  { title: 'PowerPoint slides (.pptx)', ext: /\.pptx$/, check: (b) => { expect(b.subarray(0, 2).toString()).toBe('PK'); expect(b.includes('ppt/slides/slide1.xml')).toBe(true); } },
  { title: 'Word report (.docx)', ext: /\.docx$/, check: (b) => { expect(b.subarray(0, 2).toString()).toBe('PK'); expect(b.includes('word/document.xml')).toBe(true); } },
  { title: 'PDF report', ext: /\.pdf$/, check: (b) => expect(b.subarray(0, 5).toString()).toBe('%PDF-') },
  { title: 'PNG picture of this page', ext: /\.png$/, check: (b) => expect(b.subarray(1, 4).toString()).toBe('PNG') },
  { title: 'SVG drawing of this page', ext: /\.svg$/, check: (b) => expect(b.toString('utf8', 0, 400)).toMatch(/<svg/) },
  { title: 'Web page (.html)', ext: /\.html?$/, check: (b) => expect(b.toString('utf8', 0, 400)).toMatch(/<!doctype html|<html/i) },
  { title: 'CSV tables', ext: /\.(csv|zip)$/, check: (b) => expect(b.length).toBeGreaterThan(50) },
];

test('every export makes a real file', async () => {
  const a = await launch({ name: 'exports' });
  try {
    await newClient(a.page, 'E2E Exports', TEMPLATE);
    for (const x of EXPORTS) {
      await test.step(x.title, async () => {
        const file = await exportAs(a, x.title);
        expect(path.basename(file)).toMatch(x.ext);
        x.check(fs.readFileSync(file));
      });
    }
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
