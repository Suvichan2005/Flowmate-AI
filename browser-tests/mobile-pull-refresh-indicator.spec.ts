import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function blockExternalRequests(context: BrowserContext) {
  const configured = process.env.FLOWMATE_TEST_ORIGIN || 'http://127.0.0.1:4195';
  const allowed = new Set([new URL(configured).origin, 'http://127.0.0.1', 'http://localhost']);
  await context.route('**/*', route => allowed.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
}

async function skipOptionalOnboarding(page: Page) {
  const skip = page.getByRole('button', { name: 'Skip setup for now', exact: true });
  if (await skip.count()) await skip.click();
}

test('pull-to-refresh cue sits in the created blank strip above Dashboard content', async ({ page, context }) => {
  await blockExternalRequests(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await skipOptionalOnboarding(page);

  const surface = page.getByTestId('mobile-gesture-surface');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ id: 1, x: 180, y: 250, radiusX: 1, radiusY: 1, force: 1 }],
  });
  for (const y of [275, 300, 325]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ id: 1, x: 180, y, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await page.waitForTimeout(30);
  }

  const indicator = page.getByTestId('mobile-refresh-indicator');
  await expect(indicator).toBeVisible();
  await expect(indicator).toContainText('Pull to update');
  const indicatorBox = await indicator.boundingBox();
  const surfaceBox = await surface.boundingBox();
  expect(indicatorBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  expect(await indicator.evaluate(element => element.closest('[data-testid="mobile-gesture-surface"]') === null)).toBe(true);
  expect(surfaceBox!.y).toBeGreaterThan(35);
  expect(indicatorBox!.y + indicatorBox!.height).toBeLessThanOrEqual(surfaceBox!.y + 1);
  await page.screenshot({ path: 'qa-evidence/mobile-pull-refresh-gap.png' });

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await cdp.detach();
  await expect.poll(() => surface.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m42)).toBe(0);
});
