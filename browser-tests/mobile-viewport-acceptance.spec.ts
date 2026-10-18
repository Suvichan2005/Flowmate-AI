import { expect, test, type BrowserContext } from '@playwright/test';

const origin = process.env.FLOWMATE_TEST_ORIGIN || 'http://127.0.0.1:4195';

async function blockExternalRequests(context: BrowserContext) {
  const allowedOrigin = new URL(origin).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === allowedOrigin
    ? route.continue()
    : route.abort());
}

test('phone and landscape viewport classes keep Dashboard, Chat, composer, and navigation usable', async ({ browser }) => {
  const profiles = [
    { name: 'Motorola Edge 60 Fusion', width: 407, height: 904, dpr: 3, mobile: true },
    { name: 'iPhone 18 Pro', width: 402, height: 874, dpr: 3, mobile: true },
    { name: 'iPhone 18 Pro Max', width: 440, height: 956, dpr: 3, mobile: true },
    { name: 'small iPhone', width: 390, height: 844, dpr: 3, mobile: true },
    { name: 'compact Android', width: 360, height: 800, dpr: 2.75, mobile: true },
    { name: 'narrow regression', width: 320, height: 740, dpr: 2, mobile: true },
    { name: 'phone landscape', width: 874, height: 402, dpr: 3, mobile: true },
    { name: 'compact Android landscape', width: 800, height: 360, dpr: 2.75, mobile: true },
  ];

  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.mobile,
      hasTouch: true,
    });
    await blockExternalRequests(context);
    const page = await context.newPage();
    await page.goto(`${origin}/#dashboard`);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true }), profile.name).toBeVisible();
    const skipOnboarding = page.getByRole('button', { name: 'Skip setup for now', exact: true });
    if (await skipOnboarding.count()) await skipOnboarding.click();

    if (profile.width < 768) {
      const nav = page.getByRole('navigation', { name: 'Mobile Navigation' });
      await expect(nav.getByRole('button', { name: 'Open Home', exact: true })).toBeVisible();
      await nav.getByRole('button', { name: 'Open Chat', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Navigate to Chat', exact: true }).click();
    }

    const composer = page.getByTestId('chat-composer');
    const message = page.getByRole('textbox', { name: 'Message Flowmate' });
    const send = page.getByRole('button', { name: 'Send message', exact: true });
    await expect(composer, `${profile.name}: composer visible`).toBeVisible();
    await expect(send, `${profile.name}: send control remains discoverable when empty`).toBeVisible();
    await expect(send).toBeDisabled();
    await message.fill('A multiline planning draft for responsive acceptance.\nSecond line remains reachable.');
    await expect(send).toBeEnabled();

    const geometry = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      visualHeight: window.visualViewport?.height ?? window.innerHeight,
    }));
    const composerBox = await composer.boundingBox();
    expect(geometry.scrollWidth, `${profile.name}: no horizontal page spill`).toBeLessThanOrEqual(geometry.width);
    expect(composerBox, `${profile.name}: composer has layout geometry`).not.toBeNull();
    expect(composerBox!.x).toBeGreaterThanOrEqual(0);
    expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(profile.width);
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(profile.height);
    expect(geometry.visualHeight).toBeGreaterThan(0);
    await context.close();
  }
});
