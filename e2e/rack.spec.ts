/*
 * The rack view: dragging a shape into a rack mounts the device of that kind that is already on the diagram (instead
 * of adding a second one); dragging it in again adds a new one.
 */
import { expect, test, type Page } from '@playwright/test';
import { launch, newClient, tab } from './app';

const SWITCH = 'Switch 24-port PoE + 4 SFP';
const devicesOnDiagram = async (page: Page) => {
  await page.getByRole('button', { name: /Diagram/ }).first().click();
  const n = await page.locator('.react-flow__node-device').count();
  await tab(page, 'View');
  await page.getByRole('button', { name: /^Racks/ }).click();
  return n;
};

test('dragging a shape into a rack mounts the one already on the diagram', async () => {
  const a = await launch({ name: 'rack' });
  try {
    const { page } = a;
    // A client with a switch on the diagram and no rack.
    await newClient(page, 'E2E Rack', 'Basic office diagram (no rack)');
    const before = await page.locator('.react-flow__node-device').count();
    await tab(page, 'View');
    await page.getByRole('button', { name: /^Racks/ }).click();
    await page.getByRole('button', { name: '+ Add rack' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const shape = page.locator('aside [draggable="true"]', { hasText: SWITCH }).last();
    const front = page.locator('div.rounded.bg-white.p-2.shadow-sm').first();
    await shape.dragTo(front, { targetPosition: { x: 200, y: 80 } });
    await expect(page.getByRole('status')).toContainText('the one already on the diagram');
    expect(await devicesOnDiagram(page)).toBe(before);

    // Again: none of that kind is left unracked, so a new one is added (to the rack and the diagram).
    await shape.dragTo(front, { targetPosition: { x: 200, y: 140 } });
    expect(await devicesOnDiagram(page)).toBe(before + 1);
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
