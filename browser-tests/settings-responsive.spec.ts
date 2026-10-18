import { expect, test } from '@playwright/test';

async function openSettings(page: import('@playwright/test').Page) {
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const skipOnboarding = page.getByRole('button', { name: 'Skip setup for now', exact: true });
  if (await skipOnboarding.count()) await skipOnboarding.click();

  const mobile = page.viewportSize()!.width < 768;
  if (mobile) {
    await page.getByRole('navigation', { name: 'Mobile Navigation' })
      .getByRole('button', { name: 'Open Settings', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Navigate to Settings', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}

test('Settings fills the available desktop content pane beside the chat panel', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openSettings(page);

  const main = page.locator('#main-content');
  const content = page.getByTestId('settings-content');
  const mainBox = await main.boundingBox();
  const contentBox = await content.boundingBox();

  expect(mainBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(contentBox!.width).toBeGreaterThan(mainBox!.width - 100);
  expect(mainBox!.x + mainBox!.width - (contentBox!.x + contentBox!.width)).toBeLessThanOrEqual(40);
});

test('Settings stays flush after resizing the desktop chat pane', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openSettings(page);

  const chatPane = page.getByTestId('desktop-chat-pane');
  const resizer = page.getByTestId('chat-pane-resizer');
  const main = page.locator('#main-content');
  const content = page.getByTestId('settings-content');
  const before = await chatPane.boundingBox();
  const handle = await resizer.boundingBox();
  expect(before).not.toBeNull();
  expect(handle).not.toBeNull();

  await page.mouse.move(handle!.x + handle!.width / 2, 500);
  await page.mouse.down();
  await page.mouse.move(handle!.x - 80, 500, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await chatPane.boundingBox())?.width ?? 0).toBeLessThan(before!.width - 60);
  const mainBox = await main.boundingBox();
  const contentBox = await content.boundingBox();
  expect(mainBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(mainBox!.x + mainBox!.width - (contentBox!.x + contentBox!.width)).toBeLessThanOrEqual(40);
  expect(contentBox!.width).toBeGreaterThan(mainBox!.width - 100);
});

test('Settings remains within the viewport on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);

  const content = page.getByTestId('settings-content');
  const contentBox = await content.boundingBox();
  expect(contentBox).not.toBeNull();
  expect(contentBox!.x).toBeGreaterThanOrEqual(0);
  expect(contentBox!.x + contentBox!.width).toBeLessThanOrEqual(390);
  expect(await page.locator('body').evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(390);
});
