import { test, expect } from '@playwright/test';

test('empty Graph surface sits flush in the content column beside chat', async ({ page }, testInfo) => {
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Navigate to Graph', exact: true }).click();

  const main = page.locator('#main-content');
  const emptyGraph = main.locator('div.border-dashed').filter({ hasText: 'Knowledge Graph is Empty' });
  await expect(emptyGraph).toBeVisible();

  const mainBox = await main.boundingBox();
  const graphBox = await emptyGraph.boundingBox();
  expect(mainBox).not.toBeNull();
  expect(graphBox).not.toBeNull();
  expect(Math.abs(graphBox!.x - mainBox!.x)).toBeLessThanOrEqual(1);
  expect(mainBox!.width - graphBox!.width).toBeLessThanOrEqual(12);
  await page.screenshot({ path: testInfo.outputPath('graph-pane-layout.png') });
});
