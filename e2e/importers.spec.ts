/*
 * Files from elsewhere, through the real menus: a large floor plan, a damaged one, and network scans (good and
 * damaged). Each must finish within seconds with a result or a clear message, and leave the app working.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { chooseFile, launch, newClient, tab } from './app';

const dxfDoc = (ents: string, blocks = '') => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n2\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${ents}0\nENDSEC\n0\nEOF\n`;

test('Insert → CAD Drawing: a large floor plan goes in, a damaged one is refused', async () => {
  const a = await launch({ name: 'cad' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Floor', 'Office floor plan');
    // 100,000 wall lines and 3,000 columns, in feet.
    let e = '';
    for (let i = 0; i < 3000; i++) e += `0\nCIRCLE\n10\n${i % 200}\n20\n${i % 50}\n40\n0.4\n`;
    for (let i = 0; i < 100000; i++) e += `0\nLINE\n10\n${i % 300}\n20\n${i % 77}\n11\n${(i % 300) + 1}\n21\n${i % 77}\n`;
    const big = path.join(a.files, 'big-plan.dxf');
    fs.writeFileSync(big, dxfDoc(e));
    await tab(page, 'Insert');
    const t = Date.now();
    await chooseFile(page, big, () => page.getByRole('button', { name: 'CAD Drawing' }).click());
    await expect.poll(() => a.messages.at(-1) ?? '', { timeout: 30_000 }).toMatch(/Inserted "big-plan\.dxf"[\s\S]*feet/);
    console.log(`large DXF inserted in ${Date.now() - t} ms`);
    await expect(page.locator('.react-flow__node-backdrop')).toHaveCount(1);

    // Blocks inside blocks, 40 wide and 6 deep (a 7 KB file that would expand to millions of lines).
    let blocks = '';
    for (let lvl = 0; lvl < 6; lvl++) {
      blocks += `0\nBLOCK\n2\nB${lvl}\n10\n0\n20\n0\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n`;
      if (lvl < 5) for (let i = 0; i < 40; i++) blocks += `0\nINSERT\n2\nB${lvl + 1}\n10\n${i}\n20\n0\n`;
      blocks += '0\nENDBLK\n';
    }
    const bomb = path.join(a.files, 'nested.dxf');
    fs.writeFileSync(bomb, dxfDoc('0\nINSERT\n2\nB0\n10\n0\n20\n0\n', blocks));
    await chooseFile(page, bomb, () => page.getByRole('button', { name: 'CAD Drawing' }).click());
    await expect.poll(() => a.messages.at(-1) ?? '', { timeout: 15_000 }).toMatch(/too large or too complex/);

    // Still working: the ribbon responds.
    await tab(page, 'Home');
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});

test('Data → Network Scan: an nmap scan adds devices, a damaged one is harmless', async () => {
  const a = await launch({ name: 'scan' });
  try {
    const { page } = a;
    await newClient(page, 'E2E Scan');
    const hosts = Array.from({ length: 20 }, (_, i) => `<host><status state="up"/><address addr="192.168.1.${i + 10}" addrtype="ipv4"/>`
      + `<address addr="00:11:22:33:44:${(i + 16).toString(16).padStart(2, '0')}" addrtype="mac" vendor="Dell"/><hostnames><hostname name="pc-${i}"/></hostnames>`
      + `<ports><port protocol="tcp" portid="3389"><state state="open"/></port></ports></host>`).join('');
    const scan = path.join(a.files, 'scan.xml');
    fs.writeFileSync(scan, `<?xml version="1.0"?><nmaprun>${hosts}</nmaprun>`);
    const before = await page.locator('.react-flow__node').count();
    await tab(page, 'Data');
    await page.getByRole('button', { name: 'Network Scan' }).click();
    await chooseFile(page, scan, () => page.getByRole('button', { name: 'Choose a scan file…' }).click());
    await expect(page.getByRole('button', { name: 'Choose another file' })).toBeVisible();
    await page.locator('div.fixed.inset-0 button.bg-blue-600:not([disabled])').last().click();
    await expect.poll(() => page.locator('.react-flow__node').count()).toBeGreaterThanOrEqual(before + 20);
    const close = page.locator('div.fixed.inset-0').getByRole('button', { name: 'Close' });
    if (await close.isVisible().catch(() => false)) await close.click();

    // 1.2 MB of unclosed <host> tags: read in a moment, nothing found.
    const bad = path.join(a.files, 'damaged-scan.xml');
    fs.writeFileSync(bad, `<nmaprun>${'<host>'.repeat(200_000)}`);
    await page.getByRole('button', { name: 'Network Scan' }).click();
    const t = Date.now();
    await chooseFile(page, bad, () => page.getByRole('button', { name: 'Choose a scan file…' }).click());
    await page.waitForTimeout(500);
    expect(Date.now() - t).toBeLessThan(5000);
    await page.locator('div.fixed.inset-0').getByRole('button', { name: 'Close' }).click();
    await tab(page, 'Home');
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
