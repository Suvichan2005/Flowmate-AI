import { expect, test } from '@playwright/test';

test('desktop composer stays centered at a readable width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#chat');

  const composer = page.getByRole('form', { name: 'Chat composer' });
  await expect(composer).toBeVisible();
  const bounds = await composer.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(860);
  expect(bounds!.x).toBeGreaterThan(224);
  await expect(page.getByTestId('ai-model-selector-trigger').getByText('Connect AI', { exact: true })).toBeVisible();
});

test('mobile composer keeps model, voice, attachment and send actions readable around a multiline draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#chat');

  const composer = page.getByTestId('chat-composer');
  await expect(composer).toBeVisible();
  const draft = page.getByRole('textbox', { name: 'Message Flowmate' });
  const model = composer.getByRole('button', { name: /AI unavailable/ });
  const attach = composer.getByRole('button', { name: 'Attach file' });
  const voice = composer.getByRole('button', { name: /voice unavailable/ });
  const send = composer.getByRole('button', { name: 'Send message' });

  await expect(model).toBeVisible();
  await expect(model).toBeEnabled();
  await expect(attach).toBeVisible();
  await expect(voice).toBeVisible();
  await expect(voice).toBeDisabled();
  await expect(send).toBeDisabled();

  await draft.fill('First line');
  await draft.press('Shift+Enter');
  await draft.type('Second line');
  await expect(draft).toHaveValue('First line\nSecond line');
  await expect(send).toBeEnabled();
  expect(await draft.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  await page.screenshot({ path: 'qa-evidence/flowmate-composer-mobile.png', fullPage: true });

  const bounds = await composer.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});
