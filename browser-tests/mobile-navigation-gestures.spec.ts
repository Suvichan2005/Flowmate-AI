import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function skipOptionalOnboarding(page: Page) {
  const skip = page.getByRole('button', { name: 'Skip setup for now', exact: true });
  if (await skip.count()) await skip.click();
}

function allowedTestOrigins() {
  const configured = process.env.FLOWMATE_TEST_ORIGIN || 'http://127.0.0.1:4195';
  return new Set([new URL(configured).origin, 'http://127.0.0.1', 'http://localhost']);
}

async function blockExternalRequests(context: BrowserContext) {
  const allowed = allowedTestOrigins();
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    return allowed.has(origin) ? route.continue() : route.abort();
  });
}

async function dragTouch(context: BrowserContext, page: Page, points: Array<{ x: number; y: number }>, movingSelector: string, onMove?: () => Promise<void>) {
  const cdp = await context.newCDPSession(page);
  const [start, ...rest] = points;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ id: 1, x: start.x, y: start.y, radiusX: 1, radiusY: 1, force: 1 }],
  });
  const offsets: number[] = [];
  for (const point of rest) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1 }],
    });
    offsets.push(await page.locator(movingSelector).evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41));
    await onMove?.();
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
  return offsets;
}

test('mobile screen drag opens Chat, returns to Home, and opens then drags the sidebar closed', async ({ page, context }) => {
  await blockExternalRequests(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await skipOptionalOnboarding(page);

  const nav = page.getByRole('navigation', { name: 'Mobile Navigation' });
  const openChatOffsets = await dragTouch(context, page, [
    { x: 250, y: 430 }, { x: 210, y: 430 }, { x: 170, y: 430 }, { x: 130, y: 430 },
  ], '[data-testid="mobile-gesture-surface"]', async () => {
    await expect(page.getByText('Go to Chat', { exact: true })).toBeVisible();
  });
  expect(openChatOffsets.some(offset => offset < 0)).toBe(true);
  await expect(nav.getByRole('button', { name: 'Open Chat', exact: true })).toHaveAttribute('aria-current', 'page');
  const send = page.getByRole('button', { name: 'Send message', exact: true });
  await expect(send).toBeVisible();
  await expect(send).toBeDisabled();
  await page.getByRole('textbox', { name: 'Message Flowmate' }).fill('A short mobile draft');
  await expect(send).toBeEnabled();
  await page.getByRole('textbox', { name: 'Message Flowmate' }).fill('');
  await page.screenshot({ path: 'qa-evidence/mobile-chat-composer-design-review.png' });

  const surface = page.getByTestId('mobile-gesture-surface');
  const chatReturnOffsets = await dragTouch(context, page, [
    { x: 150, y: 430 }, { x: 195, y: 430 }, { x: 235, y: 430 }, { x: 275, y: 430 },
  ], '[data-testid="mobile-gesture-surface"]');
  expect(chatReturnOffsets.some(offset => offset > 0)).toBe(true);
  await expect(nav.getByRole('button', { name: 'Open Home', exact: true })).toHaveAttribute('aria-current', 'page');

  // A short deliberate rightward drag from the middle of the page opens the sidebar.
  // Let the previous screen's return animation finish before starting a new drag;
  // otherwise the test can begin a second gesture while the surface is still moving.
  await expect.poll(() => page.getByTestId('mobile-gesture-surface').evaluate(
    element => new DOMMatrix(getComputedStyle(element).transform).m41,
  )).toBe(0);
  const openMenuOffsets = await dragTouch(context, page, [
    { x: 150, y: 430 }, { x: 172, y: 430 }, { x: 196, y: 430 }, { x: 222, y: 430 },
  ], '[data-testid="mobile-gesture-surface"]');
  expect(openMenuOffsets.some(offset => offset > 0)).toBe(true);
  const sidebar = page.getByRole('dialog', { name: 'Mobile navigation' });
  await expect(sidebar).toBeVisible();
  const panel = page.getByTestId('mobile-sidebar-panel');
  await expect.poll(() => panel.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41)).toBe(0);

  // Drag the exposed header area left; the panel follows the finger and then closes.
  const closeMenuOffsets = await dragTouch(context, page, [
    { x: 150, y: 25 }, { x: 115, y: 25 }, { x: 75, y: 25 }, { x: 30, y: 25 },
  ], '[data-testid="mobile-sidebar-panel"]');
  expect(closeMenuOffsets.some(offset => offset < 0)).toBe(true);
  await expect(sidebar).toBeHidden();
  await expect(nav.getByRole('button', { name: 'Open Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(surface).toBeVisible();

  // Chat owns rightward return gestures across the screen, including the edge.
  // This prevents a back drag from being reinterpreted as a sidebar opening.
  await nav.getByRole('button', { name: 'Open Chat', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Open Chat', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const startX of [8, 24, 42]) {
    await dragTouch(context, page, [
      { x: startX, y: 430 }, { x: startX + 35, y: 430 }, { x: startX + 72, y: 430 }, { x: startX + 112, y: 430 },
    ], '[data-testid="mobile-gesture-surface"]');
    await expect(nav.getByRole('button', { name: 'Open Home', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(sidebar).toBeHidden();
    if (startX !== 42) {
      await nav.getByRole('button', { name: 'Open Chat', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Open Chat', exact: true })).toHaveAttribute('aria-current', 'page');
    }
  }

  // The explicit menu button keeps navigation available while Chat owns edge-back.
  await nav.getByRole('button', { name: 'Open Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
  await expect(sidebar).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation menu', exact: true }).click();
  await expect(sidebar).toBeHidden();
});

test('mobile model control opens a validated catalogue and returns keyboard focus', async ({ page, context }) => {
  let catalogRequests = 0;
  await page.route('**/v1beta/models**', async route => {
    catalogRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576, outputTokenLimit: 65536 },
        { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576, outputTokenLimit: 65536 },
        { name: 'models/gemini-3.8-live', supportedGenerationMethods: ['bidiGenerateContent'] },
      ] }),
    });
  });
  await blockExternalRequests(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await skipOptionalOnboarding(page);

  const nav = page.getByRole('navigation', { name: 'Mobile Navigation' });
  await nav.getByRole('button', { name: 'Open Settings', exact: true }).click();
  await page.getByPlaceholder('Paste your Gemini API key to use BYOK').fill('synthetic-ui-only-key');
  await page.getByRole('button', { name: 'Save Key', exact: true }).click();
  await nav.getByRole('button', { name: 'Open Chat', exact: true }).click();

  const trigger = page.getByTestId('ai-model-selector-trigger');
  await expect(trigger).toBeVisible();
  await expect.poll(() => catalogRequests).toBeGreaterThan(0);
  await expect(trigger).toHaveAttribute('aria-label', /Gemini 3\.8 Flash/);
  await expect(trigger).toHaveAttribute('title', /Gemini 3\.8 Flash/);
  const triggerWidth = await trigger.evaluate(element => Math.round(element.getBoundingClientRect().width));
  expect(triggerWidth).toBeGreaterThanOrEqual(44);
  expect(triggerWidth).toBeLessThanOrEqual(64);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Model and reasoning' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Gemini 3.8 Flash/ })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Reasoning level' })).toBeVisible();
  for (const width of [320, 360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(trigger, `model control should remain available at ${width}px`).toBeVisible();
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog, `model popover should open at ${width}px`).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    const composerBox = await page.getByTestId('chat-composer').boundingBox();
    expect(dialogBox, `model popover should remain visible at ${width}px`).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(width);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(composerBox!.y);
  }

  // Pointer entry and outside dismissal must leave the draft surface usable.
  await page.setViewportSize({ width: 390, height: 844 });
  if (!(await dialog.isVisible())) await trigger.click();
  await page.getByRole('textbox', { name: 'Message Flowmate' }).fill('Keep this multiline draft.\nSecond line stays here.');
  await expect(page.getByRole('textbox', { name: 'Message Flowmate' })).toHaveValue('Keep this multiline draft.\nSecond line stays here.');
  await page.setViewportSize({ width: 768, height: 844 });
  await expect(page.getByRole('textbox', { name: 'Message Flowmate' })).toHaveValue('Keep this multiline draft.\nSecond line stays here.');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('textbox', { name: 'Message Flowmate' })).toHaveValue('Keep this multiline draft.\nSecond line stays here.');
  await page.getByRole('textbox', { name: 'Message Flowmate' }).click();
  await expect(dialog).toBeHidden();
  await trigger.press('ArrowDown');
  await expect(dialog).toBeVisible();
  const options = dialog.getByRole('option');
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('button', { name: 'High', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'High', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'qa-evidence/mobile-model-selector-design-review.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
