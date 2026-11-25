/*
 * The Word, PowerPoint, Excel and Visio files RackDraw writes, opened in real Microsoft Office: they must open without
 * a repair prompt and contain the drawing. Runs only on Windows with Office installed (skipped elsewhere, e.g. CI).
 */
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { exportAs, launch, newClient } from './app';

const installed = (prog: string) => {
  if (process.platform !== 'win32') return false;
  try { execFileSync('reg', ['query', `HKCR\\${prog}`], { stdio: 'ignore' }); return true; } catch { return false; }
};

function openIn(app: string, file: string): Record<string, unknown> {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('e2e/office-open.ps1'), '-App', app, '-Path', file], { encoding: 'utf8', timeout: 120_000 });
  return JSON.parse(out.trim().split(/\r?\n/).pop() ?? '{}');
}

const CASES = [
  { app: 'word', prog: 'Word.Application', title: 'Word report (.docx)', expect: (r: Record<string, unknown>) => { expect(r.paragraphs as number).toBeGreaterThan(5); expect(r.tables as number).toBeGreaterThan(0); } },
  { app: 'powerpoint', prog: 'PowerPoint.Application', title: 'PowerPoint slides (.pptx)', expect: (r: Record<string, unknown>) => expect(r.slides as number).toBeGreaterThan(1) },
  { app: 'excel', prog: 'Excel.Application', title: 'CSV tables', expect: (r: Record<string, unknown>) => expect(r.rows as number).toBeGreaterThan(5) },
  { app: 'visio', prog: 'Visio.Application', title: 'Visio drawing (.vsdx)', expect: (r: Record<string, unknown>) => { expect(r.pages as number).toBeGreaterThan(0); expect(r.shapes as number).toBeGreaterThan(10); } },
];

test('exports open in Microsoft Office', async () => {
  const todo = CASES.filter((c) => installed(c.prog));
  test.skip(!todo.length, 'Microsoft Office is not installed');
  const a = await launch({ name: 'office' });
  try {
    await newClient(a.page, 'E2E Office check', 'Small network + rack (up to 25 users)');
    for (const c of todo) {
      await test.step(`${c.title} in ${c.app}`, async () => {
        const file = await exportAs(a, c.title);
        const r = openIn(c.app, file);
        console.log(c.app, JSON.stringify(r));
        if (r.skipped) return test.info().annotations.push({ type: 'skipped', description: `${c.app}: ${r.skipped}` });
        expect(r.error ?? null).toBeNull();
        c.expect(r);
      });
    }
  } finally {
    await a.close();
  }
});
