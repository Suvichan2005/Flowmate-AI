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

test('Settings is organized into native expandable groups instead of jump buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page);

  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toHaveCount(0);
  const general = page.getByTestId('settings-group-general');
  const ai = page.getByTestId('settings-group-ai');
  const context = page.getByTestId('settings-group-context');
  const privacy = page.getByTestId('settings-group-privacy');
  const data = page.getByTestId('settings-group-data');
  await expect(general.locator(':scope > summary')).toContainText('General');
  await expect(ai.locator(':scope > summary')).toContainText('AI & Models');
  await expect(context.locator(':scope > summary')).toContainText('Personal context');
  await expect(privacy.locator(':scope > summary')).toContainText('Privacy & Sync');
  await expect(data.locator(':scope > summary')).toContainText('Data & Backup');
  await expect(page.getByTestId('settings-group-preferences')).toHaveCount(0);
  expect(await general.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
  expect(await ai.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true);
  expect(await privacy.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
  await privacy.locator(':scope > summary').click();
  expect(await privacy.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true);
  await expect(privacy.getByRole('heading', { name: 'Privacy & Context' })).toBeVisible();
  await expect(privacy.getByRole('heading', { name: 'Persistent Memory & Situational State' })).toHaveCount(0);
  await context.locator(':scope > summary').click();
  await expect(context.getByRole('heading', { name: 'Persistent Memory & Situational State' })).toBeVisible();
  await expect(context.getByRole('heading', { name: 'Location & Travel' })).toHaveCount(0);
  await expect(page.getByText('Default Starting Location / Home Base', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Station Arrival Buffer (minutes)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Airport Arrival Buffer (minutes)', { exact: true })).toHaveCount(0);
  await ai.locator(':scope > summary').click();
  expect(await ai.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true);
  expect(await privacy.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
  await expect(ai.locator('details.settings-subgroup > summary')).toContainText('Assistant style');
  expect(await ai.locator('details.settings-subgroup').evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
  await ai.locator('details.settings-subgroup > summary').click();
  await expect(ai.getByText('Custom System Instructions')).toBeVisible();

  await general.locator(':scope > summary').click();
  expect(await general.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true);
  await expect(general.getByRole('heading', { name: 'Your Flowmate profile' })).toBeVisible();
  await expect(general.getByRole('heading', { name: 'Planning defaults' })).toBeVisible();
  await expect(general.getByRole('switch', { name: 'Debug Mode' })).toHaveCount(0);
  expect(await ai.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);

  await general.locator(':scope > summary').focus();
  await general.locator(':scope > summary').press('Enter');
  expect(await general.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);

  const advanced = page.getByTestId('settings-group-advanced');
  await advanced.locator(':scope > summary').click();
  await expect(advanced.getByRole('switch', { name: 'Debug Mode' })).toBeVisible();
});

test('AI settings keep model, usage and own-key controls in one focused flow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openSettings(page);
  const ai = page.getByTestId('settings-group-ai');
  if (!(await ai.evaluate(element => (element as HTMLDetailsElement).open))) {
    await ai.locator(':scope > summary').click();
  }

  await expect(ai.getByRole('heading', { name: 'Model and reasoning' })).toBeVisible();
  await expect(ai.getByLabel('AI model')).toBeVisible();
  await expect(ai.getByText('Use your own Gemini key')).toBeVisible();
  await expect(ai.getByLabel('Your Gemini API key')).toBeVisible();
  await expect(ai.getByText('Sync AI preferences to my account')).toHaveCount(0);
  await expect(ai.getByText('Save voice transcripts in chat history')).toHaveCount(0);
  await page.screenshot({ path: 'qa-evidence/flowmate-settings-ai-clean.png', fullPage: true });
});

test('narrow composer keeps model, voice, attachment and send actions inside one surface', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/#chat');

  const composer = page.getByTestId('chat-composer');
  await expect(composer).toBeVisible();
  const actions = composer.getByTestId('chat-composer-actions');
  const model = composer.getByTestId('ai-model-selector-trigger');
  const bounds = await actions.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await expect(model).toBeVisible();
  await expect(model.getByText('Unavailable', { exact: true })).toBeHidden();
  await expect(composer.getByRole('button', { name: 'Attach file' })).toBeVisible();
  await expect(composer.getByRole('button', { name: /Gemini Live voice/i })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Send message' })).toBeVisible();
  expect(await page.locator('body').evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(320);
});

test('narrow desktop chat pane compacts its model control without clipping composer actions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const skipOnboarding = page.getByRole('button', { name: 'Skip setup for now', exact: true });
  if (await skipOnboarding.count()) await skipOnboarding.click();

  const chatPane = page.getByTestId('desktop-chat-pane');
  const resizer = page.getByTestId('chat-pane-resizer');
  const handle = await resizer.boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, 450);
  await page.mouse.down();
  await page.mouse.move(handle!.x - 120, 450, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await chatPane.boundingBox())?.width ?? 0).toBe(300);

  const composer = page.getByTestId('chat-composer');
  const actions = composer.getByTestId('chat-composer-actions');
  const model = composer.getByTestId('ai-model-selector-trigger');
  const paneBounds = await chatPane.boundingBox();
  const composerBounds = await composer.boundingBox();
  const actionsBounds = await actions.boundingBox();
  const modelBounds = await model.boundingBox();
  expect(paneBounds && composerBounds && actionsBounds && modelBounds).not.toBeNull();
  expect(modelBounds!.width).toBeLessThanOrEqual(64);
  expect(actionsBounds!.x).toBeGreaterThanOrEqual(paneBounds!.x);
  expect(actionsBounds!.x + actionsBounds!.width).toBeLessThanOrEqual(paneBounds!.x + paneBounds!.width + 1);
  expect(composerBounds!.x + composerBounds!.width).toBeLessThanOrEqual(paneBounds!.x + paneBounds!.width + 1);
  for (const label of ['Attach file', /Gemini Live voice/, 'Send message']) {
    const control = actions.getByRole('button', { name: label });
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(paneBounds!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(paneBounds!.x + paneBounds!.width + 1);
  }
});

test('composer places model selection beside voice and offers a path to connect when unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#chat');
  const composer = page.getByTestId('chat-composer');
  const actions = composer.getByTestId('chat-composer-actions');
  const attach = await actions.getByRole('button', { name: 'Attach file' }).boundingBox();
  const model = await actions.getByTestId('ai-model-selector-trigger').boundingBox();
  const voice = await actions.getByRole('button', { name: /Gemini Live voice/i }).boundingBox();
  const send = await actions.getByRole('button', { name: 'Send message' }).boundingBox();
  expect(attach).not.toBeNull();
  expect(model).not.toBeNull();
  expect(voice).not.toBeNull();
  expect(send).not.toBeNull();
  expect(attach!.x).toBeLessThan(model!.x);
  expect(model!.x).toBeLessThan(voice!.x);
  expect(voice!.x).toBeLessThan(send!.x);
  await actions.getByTestId('ai-model-selector-trigger').click();
  const picker = page.getByRole('dialog', { name: 'Model and reasoning' });
  await expect(picker).toBeVisible();
  const pickerBox = await picker.boundingBox();
  const desktopPaneBox = await page.locator('[data-layout="desktop"]').boundingBox();
  expect(pickerBox).not.toBeNull();
  expect(desktopPaneBox).not.toBeNull();
  expect(pickerBox!.x).toBeGreaterThanOrEqual(desktopPaneBox!.x);
  expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(1280);
  await expect(page.getByText(/Saved model unavailable|Connect an AI provider to start a conversation/)).toBeVisible();
  await expect(page.getByText('No provider connected')).toBeVisible();
  await page.getByRole('button', { name: 'Open AI settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});
