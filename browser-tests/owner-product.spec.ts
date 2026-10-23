import { test, expect, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

async function navigate(page: Page, route: string) {
  if (page.viewportSize()!.width < 768) {
    const bottomNavigation = page.getByRole('navigation', { name: 'Mobile Navigation' });
    const bottomLabel: Record<string, string> = { Dashboard: 'Open Home', Chat: 'Open Chat', Library: 'Open Library', Calendar: 'Open Calendar', Settings: 'Open Settings' };
    if (bottomLabel[route]) {
      await bottomNavigation.getByRole('button', { name: bottomLabel[route], exact: true }).click();
    } else {
      await page.getByRole('button', { name: /open navigation menu/i }).click();
      await page.getByRole('dialog', { name: 'Mobile navigation' }).getByRole('button', { name: 'Navigate to ' + route, exact: true }).click();
    }
  } else {
    await page.getByRole('button', { name: 'Navigate to ' + route, exact: true }).click();
  }
  const main = page.viewportSize()!.width < 768 ? page.getByRole('main').last() : page.locator('#main-content');
  if (route === 'Chat') await expect(page.getByTestId('conversation-switcher')).toBeVisible();
  else if (route === 'Dashboard') await expect(main.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  else if (route === 'Graph') await expect(page.getByRole('heading', { name: 'Knowledge Graph is Empty' }).or(page.getByText(/Nodes.*Links/)).first()).toBeVisible();
  else if (route === 'Calendar') await expect(main.locator('h1')).toBeVisible();
  else if (route === 'Analytics') await expect(main.getByRole('heading', { name: 'Progress Intelligence' })).toBeVisible();
  else if (route === 'Library') await expect(main.locator('h1')).toContainText('Library');
  else if (route === 'Settings') await expect(main.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message Flowmate' }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('[data-message-id]').filter({ hasText: text }).first()).toBeVisible();
  await expect(page.getByText(/^(?:No AI response · unavailable|Local rules · no AI request)$/).last()).toBeVisible();
}
test.beforeEach(async ({ context, page }) => {
  const testOrigin = process.env.FLOWMATE_TEST_ORIGIN || 'http://127.0.0.1:4195';
  // Routing around a controlled request can bypass its service-worker fetch
  // handler. The production preview uses an empty, keyless build and runs on
  // loopback, so preserve native requests for that dedicated test.
  if (!process.env.FLOWMATE_PRODUCTION_OFFLINE) {
    await context.route('**/*', r => new URL(r.request().url()).origin === testOrigin ? r.continue() : r.abort());
  }
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  // Fresh production-profile contexts receive first-run onboarding. Dismiss it
  // before exercising independent route journeys so it cannot intercept nav.
  const skipOnboarding = page.getByRole('button', { name: 'Skip setup for now', exact: true });
  if (await skipOnboarding.count()) await skipOnboarding.click();
});

test('fork parent child edit reload delete and restore preserve conversation history', async ({ page }) => {
  await navigate(page, 'Chat');
  await page.getByRole('button', { name: 'New Chat', exact: true }).click();
  const branchToggle = page.getByTestId('branch-menu-toggle');
  const openBranchMenu = async () => {
    if (await branchToggle.getAttribute('aria-expanded') !== 'true') await branchToggle.click();
    return page.getByRole('list', { name: 'Conversation branches' });
  };
  const selectedBranchId = async () => {
    const menu = await openBranchMenu();
    const id = await menu.locator('[aria-current="true"]').getAttribute('data-branch-id');
    await branchToggle.click();
    return id!;
  };
  const parent = await selectedBranchId();
  await send(page, 'Synthetic original question');
  const conversation = await page.getByTestId('conversation-switcher').getAttribute('aria-label');
  await send(page, 'Synthetic parent continuation');
  const userMessage = page.locator('[data-message-id]').filter({ hasText: 'Synthetic original question' }).first();
  await userMessage.getByRole('button', { name: 'Edit message', exact: true }).click();
  await userMessage.getByRole('button', { name: 'Fork', exact: true }).click();
  const child = await selectedBranchId(); expect(child).not.toBe(parent);
  await expect(page.getByText('Synthetic parent continuation', { exact: true })).toHaveCount(0);
  await send(page, 'Synthetic child continuation');
  await (await openBranchMenu()).locator(`[data-branch-id="${parent}"]`).click();
  await expect(page.getByText('Synthetic parent continuation', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic child continuation', { exact: true })).toHaveCount(0);
  await (await openBranchMenu()).locator(`[data-branch-id="${child}"]`).click();
  await expect(page.getByText('Synthetic child continuation', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Flowmate' }).fill('Unsent child draft');
  await page.reload();
  await expect(page.getByTestId('conversation-switcher')).toHaveAttribute('aria-label', conversation!);
  expect(await selectedBranchId()).toBe(child);
  await expect(page.getByRole('textbox', { name: 'Message Flowmate' })).toHaveValue('Unsent child draft');
  const childMessage = page.locator('[data-message-id]').filter({ hasText: 'Synthetic child continuation' }).first();
  await childMessage.getByRole('button', { name: 'Edit message', exact: true }).click();
  await childMessage.locator('textarea').fill('Synthetic edited continuation');
  await childMessage.getByRole('button', { name: 'Fork & Send', exact: true }).click();
  await expect(page.getByText('Synthetic edited continuation', { exact: true })).toBeVisible();
  const editedBranch = await selectedBranchId(); expect(editedBranch).not.toBe(child);
  await (await openBranchMenu()).locator(`[data-branch-id="${child}"]`).click();
  await expect(page.getByText('Synthetic child continuation', { exact: true })).toBeVisible();
  const menu = await openBranchMenu();
  const name = (await menu.locator(`[data-branch-id="${child}"]`).textContent())!.split(' · from')[0].trim();
  await page.getByRole('button', { name: 'Delete branch ' + name, exact: true }).click();
  expect(await selectedBranchId()).toBe(parent);
  await page.reload();
  await branchToggle.click();
  await page.getByRole('button', { name: 'Restore branch ' + name, exact: true }).click();
  expect(await selectedBranchId()).toBe(child);
  await expect(page.getByText('Synthetic child continuation', { exact: true })).toBeVisible();
  await (await openBranchMenu()).locator(`[data-branch-id="${parent}"]`).click();
  await expect(page.getByText('Synthetic parent continuation', { exact: true })).toBeVisible();
});

test('conversation and branch names edit in-app; delete confirms and removes the conversation', async ({ page }) => {
  await navigate(page, 'Chat');
  await page.getByRole('button', { name: 'New Chat', exact: true }).click();
  const conversation = page.getByTestId('conversation-switcher');
  const branchToggle = page.getByTestId('branch-menu-toggle');
  await branchToggle.click();

  await page.getByRole('button', { name: 'Rename branch Main', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Rename branch' });
  const branchName = dialog.getByRole('textbox', { name: 'Branch name' });
  await expect(branchName).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rename branch Main' })).toBeFocused();

  await page.getByRole('button', { name: 'Rename branch Main', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Rename branch' });
  await dialog.getByRole('textbox', { name: 'Branch name' }).fill('Planning thread');
  await dialog.getByRole('button', { name: 'Save name' }).click();
  await expect(branchToggle).toContainText('Planning thread');

  await conversation.click();
  await page.getByRole('button', { name: /Rename conversation New Chat/ }).click();
  dialog = page.getByRole('dialog', { name: 'Rename conversation' });
  await dialog.getByRole('textbox', { name: 'Conversation name' }).fill('Weekly planning');
  await dialog.getByRole('button', { name: 'Save name' }).click();
  await expect(conversation).toContainText('Weekly planning');
  await page.getByRole('button', { name: 'New Chat', exact: true }).click();
  await conversation.click();
  await page.getByRole('textbox', { name: 'Search conversations' }).fill('Weekly');
  await page.getByRole('button', { name: 'Weekly planning', exact: true }).click();
  await expect(conversation).toContainText('Weekly planning');
  await send(page, 'Message that should be removed with this test conversation');

  await conversation.click();
  await page.getByRole('button', { name: 'Delete conversation Weekly planning', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Delete conversation?' });
  await dialog.getByRole('button', { name: 'Keep conversation' }).click();
  await expect(conversation).toContainText('Weekly planning');

  await page.getByRole('button', { name: 'Delete conversation Weekly planning', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Delete conversation?' });
  await dialog.getByRole('button', { name: 'Delete conversation', exact: true }).click();
  await expect(conversation).toContainText('New Chat');
  await expect(page.getByText('Message that should be removed with this test conversation', { exact: true })).toHaveCount(0);
  await conversation.click();
  await page.getByRole('button', { name: 'General Chat', exact: true }).click();
  await expect(conversation).toContainText('General Chat');
  await conversation.click();
  await expect(page.getByText('The default conversation stays in your workspace.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete conversation General Chat', exact: true })).toHaveCount(0);
});

test('commands navigate and transfer unsupported text to the single draft without submission', async ({ page }) => {
  await expect(page.getByTestId('omni-command-dock')).toHaveCount(0);
  const open = page.getByRole('button', { name: 'Open command palette', exact: true });
  await open.click(); const dialog = page.getByRole('dialog', { name: 'Command palette and intent capture' });
  await dialog.getByRole('textbox').fill('Go to Calendar'); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#calendar$/); await expect(dialog).toHaveCount(0);
  await open.click(); await dialog.getByRole('textbox').fill('Unrecognized synthetic request');
  await expect(dialog.getByTestId('inferred-intent-card')).toHaveCount(0);
  await page.keyboard.press('Enter'); await expect(page).toHaveURL(/#chat$/);
  await expect(page.getByRole('textbox', { name: 'Message Flowmate' })).toHaveValue('Unrecognized synthetic request');
  await expect(page.locator('[data-message-id]').filter({ hasText: 'Unrecognized synthetic request' })).toHaveCount(0);
  await page.keyboard.press('Control+k'); await expect(dialog).toBeVisible(); await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Flowmate' })).toBeFocused();
});

test('removed Phase 0 spike bookmark returns to the normal workspace', async ({ page }) => {
  await page.evaluate(() => { window.location.hash = '#spike'; });
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.locator('#kernel-spike-overlay')).toHaveCount(0);
  await expect(page.locator('#spike-status-verified')).toHaveCount(0);
  await expect(page).toHaveURL(/#dashboard$/);
});

test('D3 graph renders empty through large synthetic graphs with finite geometry', async ({ page }) => {
  test.skip(Boolean(process.env.FLOWMATE_PRODUCTION_OFFLINE), 'synthetic GraphView harness is intentionally excluded from production artifacts');
  test.setTimeout(120000);
  const cases = [
    { shape: 'empty', nodes: 0, links: 0 },
    { shape: 'single', nodes: 1, links: 0 },
    { shape: 'disconnected', nodes: 8, links: 0 },
    { shape: 'dense', nodes: 16, links: 120 },
    { shape: 'large', nodes: 240, links: 480 },
  ];
  mkdirSync('qa-evidence/graph', { recursive: true });
  for (const shape of cases) {
    await page.goto(`/browser-tests/graph-harness.html?shape=${shape.shape}`);
    if (shape.shape === 'empty') {
      await expect(page.getByText('Your knowledge graph is empty', { exact: true })).toBeVisible();
      continue;
    }
    const canvas = page.getByTestId('graph-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('g.node')).toHaveCount(shape.nodes);
    await expect(canvas.locator('line.link')).toHaveCount(shape.links);
    await expect.poll(async () => canvas.evaluate(svg => {
      const viewBox = svg.getAttribute('viewBox')?.split(/[ ,]+/).map(Number) || [];
      const group = svg.querySelector(':scope > g');
      const transforms = [...svg.querySelectorAll('g.node')].map(node => node.getAttribute('transform') || '');
      const edgeValues = [...svg.querySelectorAll('line.link')].flatMap(line => ['x1', 'y1', 'x2', 'y2'].map(key => Number(line.getAttribute(key))));
      return { viewBox, hasGroup: !!group, transforms, edgeValues };
    })).toMatchObject({ hasGroup: true });
    const geometry = await canvas.evaluate(svg => {
      const viewBox = svg.getAttribute('viewBox')?.split(/[ ,]+/).map(Number) || [];
      const nodePositions = [...svg.querySelectorAll('g.node')].map(node => {
        const match = node.getAttribute('transform')?.match(/translate\(([-\d.e]+),\s*([-\d.e]+)\)/);
        return match ? [Number(match[1]), Number(match[2])] : [];
      });
      const edgeValues = [...svg.querySelectorAll('line.link')].flatMap(line => ['x1', 'y1', 'x2', 'y2'].map(key => Number(line.getAttribute(key))));
      return { viewBox, nodePositions, edgeValues };
    });
    expect(geometry.viewBox).toHaveLength(4);
    expect(geometry.viewBox[2]).toBeGreaterThan(0);
    expect(geometry.viewBox[3]).toBeGreaterThan(0);
    expect(geometry.nodePositions).toHaveLength(shape.nodes);
    expect(geometry.nodePositions.flat().every(Number.isFinite)).toBe(true);
    expect(geometry.edgeValues.every(Number.isFinite)).toBe(true);
    if (shape.shape === 'dense' || shape.shape === 'large') {
      await expect.poll(() => canvas.evaluate(svg => [...svg.querySelectorAll('line.link')].every(line => {
        const relationshipType = (line as SVGLineElement).dataset.relationshipType;
        const marker = line.getAttribute('marker-end')?.match(/url\(#([^)]+)\)/)?.[1];
        return relationshipType === 'RELATED_TO' ? marker === undefined : !!marker && !!svg.querySelector(`#${CSS.escape(marker)}`);
      }))).toBe(true);
      await expect.poll(() => canvas.evaluate(svg => {
        const rect = svg.getBoundingClientRect();
        return [...svg.querySelectorAll('g.node circle')].every(circle => {
          const nodeRect = circle.getBoundingClientRect();
          return nodeRect.left >= rect.left - 1 && nodeRect.right <= rect.right + 1 &&
            nodeRect.top >= rect.top - 1 && nodeRect.bottom <= rect.bottom + 1;
        });
      }), { timeout: 30000 }).toBe(true);
      await page.screenshot({ path: `qa-evidence/graph/after-d3-${shape.shape}.png` });
    }
  }
});

test('D3 node selection does not destroy its simulation DOM or camera', async ({ page }) => {
  test.skip(Boolean(process.env.FLOWMATE_PRODUCTION_OFFLINE), 'synthetic GraphView harness is intentionally excluded from production artifacts');
  await page.goto('/browser-tests/graph-harness.html?shape=dense');
  const canvas = page.getByTestId('graph-canvas');
  const firstNode = canvas.locator('g.node').first();
  const graphGroup = canvas.locator(':scope > g');
  await expect(firstNode).toBeVisible();
  await firstNode.evaluate(node => node.setAttribute('data-lifecycle-probe', 'retained'));
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Graph canvas has no browser layout bounds');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => Number((await canvas.locator(':scope > g').getAttribute('transform'))?.match(/scale\(([^)]+)\)/)?.[1] || 1)).toBeGreaterThan(1);
  await graphGroup.evaluate(group => group.setAttribute('data-lifecycle-probe', 'retained'));
  await page.screenshot({ path: 'qa-evidence/graph/after-selection.png' });
  await firstNode.locator('circle').click({ force: true });
  await expect(firstNode).toHaveAttribute('data-lifecycle-probe', 'retained');
  await expect(graphGroup).toHaveAttribute('data-lifecycle-probe', 'retained');
  await expect(canvas.locator('g.node')).toHaveCount(16);
  await expect.poll(async () => Number((await graphGroup.getAttribute('transform'))?.match(/scale\(([^)]+)\)/)?.[1] || 1)).toBeGreaterThan(1.4999);
  const selectedCamera = await graphGroup.getAttribute('transform');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForTimeout(100);
  await expect(graphGroup).toHaveAttribute('transform', selectedCamera || '');
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.evaluate(() => window.dispatchEvent(new Event('graphfixture:add-node')));
  await page.waitForTimeout(100);
  expect(runtimeErrors).toEqual([]);
  await expect(canvas.locator('g.node')).toHaveCount(17);
  await expect(canvas.locator('line.link')).toHaveCount(121);
  await expect(firstNode).toHaveAttribute('data-lifecycle-probe', 'retained');
  await expect(graphGroup).toHaveAttribute('data-lifecycle-probe', 'retained');
  await page.screenshot({ path: 'qa-evidence/graph/after-selection-resize.png' });
});

test('keyless workspace does not present local rules as AI and does not contact a model provider', async ({ page, context }) => {
  const aiEndpointRequests: string[] = [];
  context.on('request', request => {
    const url = request.url();
    if (url.includes('generativelanguage.googleapis.com') || url.includes('/managedGemini')) {
      aiEndpointRequests.push(new URL(url).origin + new URL(url).pathname);
    }
  });
  await navigate(page, 'Settings');
  await expect(page.getByText('Gemini not configured', { exact: true }).first()).toBeVisible();
  await navigate(page, 'Chat');
  await send(page, 'Show my tasks');
  await expect(page.getByText(/Gemini is not configured, so Flowmate did not generate an AI response/).last()).toBeVisible();
  await expect(page.getByText('No AI response · unavailable').last()).toBeVisible();
  expect(aiEndpointRequests).toEqual([]);
});

test('production service worker restores the cached workspace after offline reload', async ({ page, context }) => {
  test.skip(!process.env.FLOWMATE_PRODUCTION_OFFLINE, 'Requires the isolated production preview with service workers enabled.');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    }
    const assets = [...document.scripts].map(script => script.src).concat(
      [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => (link as HTMLLinkElement).href)
    ).filter(url => url.startsWith(location.origin));
    // Force one real, controlled request for each referenced shell asset.
    // This also covers first-load timing where registration completes after
    // the browser already fetched the original document's script tags.
    await Promise.all(assets.map(url => fetch(url).then(response => {
      if (!response.ok) throw new Error('Shell asset request failed: ' + response.status + ' ' + url);
    })));
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const cache = await caches.open('flowmate-v4-themes-1');
      const cached = await Promise.all(assets.map(url => cache.match(url)));
      if (cached.every(Boolean)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const registrations = await navigator.serviceWorker.getRegistrations();
    const cacheNames = await caches.keys();
    const cacheContents = await Promise.all(cacheNames.map(async name => ({ name, urls: (await (await caches.open(name)).keys()).map(request => request.url) })));
    throw new Error('Production shell assets were not cached by the service worker: ' + JSON.stringify({ assets, controlled: !!navigator.serviceWorker.controller, registrations: registrations.map(r => ({ scope: r.scope, active: r.active?.state })), cacheContents }));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('Browser offline. Your workspace remains available locally.', { exact: true })).toBeVisible();
});

test('arbitrary user-created CRUD propagates to graph timeline calendar analytics and reload', async ({ page, context }) => {
  test.setTimeout(150000);
  const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  const day = date.toISOString().slice(0, 10);
  const create = async (kind: string, title: string, dated = false) => {
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New Entity' });
    await dialog.getByRole('button', { name: kind, exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    if (dated) await dialog.getByLabel('Date', { exact: true }).fill(day + 'T17:00');
    await dialog.getByRole('button', { name: 'Create ' + kind, exact: true }).click();
    await expect(dialog).not.toBeVisible();
  };
  await create('GOAL', 'QA arbitrary goal'); await create('PROJECT', 'QA arbitrary project');
  await create('TASK', 'QA arbitrary task', true); await create('EVENT', 'QA arbitrary event', true);
  await create('HABIT', 'QA arbitrary habit');
  await page.getByRole('button', { name: 'Generate Local Summary', exact: true }).click();
  await expect(page.getByText(/Local briefing: you have 1 active task/)).toBeVisible();
  await navigate(page, 'Library');
  await page.getByRole('heading', { name: 'QA arbitrary task', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Entity details' });
  await panel.getByRole('button', { name: 'Add relationship', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Relationship type' }).selectOption('FULFILLS');
  await panel.getByPlaceholder('Search entities...').fill('QA arbitrary goal');
  await panel.getByRole('button', { name: /GOAL QA arbitrary goal/ }).click();
  await expect(panel.getByText('QA arbitrary goal', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Close entity details' }).click();
  await navigate(page, 'Graph'); await expect(page.locator('svg g.node')).toHaveCount(5);
  await expect(page.locator('svg line.link')).toHaveCount(1);
  await navigate(page, 'Calendar'); await expect(page.getByText('QA arbitrary event', { exact: true }).first()).toBeVisible();
  await navigate(page, 'Analytics'); await expect(page.getByRole('heading', { name: 'QA arbitrary habit', exact: true })).toBeVisible();
  await navigate(page, 'Library'); await page.getByRole('heading', { name: 'QA arbitrary task', exact: true }).click();
  await panel.getByTitle('Edit Entity', { exact: true }).click();
  await panel.getByRole('textbox', { name: 'Entity title' }).fill('QA edited task');
  await panel.getByRole('combobox', { name: 'Entity status' }).selectOption('COMPLETED');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'QA edited task' })).toBeVisible();
  await panel.getByRole('button', { name: 'Close entity details' }).click();
  await navigate(page, 'Dashboard'); await page.getByRole('button', { name: 'Update Local Summary', exact: true }).click();
  await expect(page.getByText(/Local briefing: you have 0 active tasks/)).toBeVisible();
  await page.reload(); await navigate(page, 'Library');
  await expect(page.getByRole('heading', { name: 'QA edited task', exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'QA arbitrary event', exact: true }).click();
  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review & Edit Operations' });
  await expect(review.getByRole('note')).toHaveText(/cannot currently be undone/);
  await review.getByRole('button', { name: 'Apply (1)', exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'QA arbitrary event', exact: true })).toHaveCount(0);
  await page.reload(); await navigate(page, 'Library');
  await expect(page.getByRole('heading', { name: 'QA arbitrary event', exact: true })).toHaveCount(0);
  const second = await context.newPage(); await second.goto('/#knowledge');
  await expect(second.getByRole('heading', { name: 'QA edited task', exact: true })).toBeVisible();
  // A Vite dev page cannot prove offline startup: disabling networking breaks
  // its module/HMR transport. Keep this journey online and test local storage
  // through reload; production service-worker offline startup is a separate gate.
  await context.setOffline(true);
  await expect(page.getByText('Browser offline. Your workspace remains available locally.', { exact: true })).toBeVisible();
  await context.setOffline(false);
  await second.close();
});

test('production workspace has no synthetic sample entry point or injected recruiter records', async ({ page }) => {
  await navigate(page, 'Settings');
  await expect(page.getByRole('region', { name: 'Sample workspace' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /sample workspace/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /reset sample data/i })).toHaveCount(0);
  await navigate(page, 'Dashboard');
  await expect(page.getByTestId('demo-workspace-banner')).toHaveCount(0);
  await navigate(page, 'Library');
  await expect(page.getByText(/recruiter portfolio|distributed kernel|task-security-gate/i)).toHaveCount(0);
});

test('analytics columns follow the available split pane width', async ({ page }) => {
  await navigate(page, 'Analytics');
  const layout = page.getByTestId('analytics-layout');
  const summaryGrid = page.getByTestId('analytics-summary-grid');
  const columnCount = () => summaryGrid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  await expect.poll(columnCount).toBe(1);
  const splitWidth = await layout.evaluate(element => element.clientWidth);
  expect(splitWidth).toBeLessThan(1120);

  await page.getByRole('button', { name: 'Close Chat', exact: true }).click();
  await expect.poll(columnCount).toBe(2);
  const fullWidth = await layout.evaluate(element => element.clientWidth);
  expect(fullWidth).toBeGreaterThanOrEqual(1120);
});

test('branch manager is an adjacent header action beside New Chat', async ({ page }) => {
  await navigate(page, 'Chat');
  const actions = page.getByTestId('chat-session-actions');
  const newChat = actions.getByRole('button', { name: 'New Chat' });
  const branch = actions.getByRole('button', { name: 'Select or manage branches' });
  await expect(newChat).toBeVisible();
  await expect(branch).toContainText('Main');
  const newRect = await newChat.boundingBox(); const branchRect = await branch.boundingBox();
  expect(newRect && branchRect && branchRect.x).toBeGreaterThan(newRect?.x || 0);
  await branch.click();
  const branchList = page.getByRole('list', { name: 'Conversation branches' });
  await expect(branchList).toBeVisible();
  const branchMenu = branchList.locator('..');
  expect(await branchMenu.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Conversation branch' })).toHaveCount(0);
  await page.screenshot({ path: 'qa-evidence/branch-control.png' });
});

test('collapsed chat toggle does not cover the graph summary', async ({ page }) => {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Entity' });
  await dialog.getByRole('button', { name: 'GOAL', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Graph summary collision check');
  await dialog.getByRole('button', { name: 'Create GOAL', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Close Chat', exact: true }).click();
  const chatToggle = page.getByRole('button', { name: 'Open chat panel', exact: true });
  await expect(chatToggle).toBeVisible();
  await navigate(page, 'Graph');
  const summary = page.getByTestId('graph-summary');
  await expect(summary).toBeVisible();
  const toggleRect = await chatToggle.boundingBox();
  const summaryRect = await summary.boundingBox();
  expect(toggleRect && summaryRect).not.toBeNull();
  const overlaps = toggleRect!.x < summaryRect!.x + summaryRect!.width &&
    toggleRect!.x + toggleRect!.width > summaryRect!.x &&
    toggleRect!.y < summaryRect!.y + summaryRect!.height &&
    toggleRect!.y + toggleRect!.height > summaryRect!.y;
  expect(overlaps).toBe(false);
});

test('chat renders in collapsed navigation and compact command search stays inside the rail', async ({ page }) => {
  const onboarding = page.getByRole('dialog', { name: 'Make Flowmate yours' });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole('button', { name: 'Close onboarding' }).click();
    await expect(onboarding).toBeHidden();
  }
  await page.getByRole('button', { name: 'Zen', exact: true }).click();
  await expect(page.getByTestId('desktop-chat-pane')).toBeVisible();
  await navigate(page, 'Chat');
  await expect(page.getByTestId('conversation-switcher')).toBeVisible();
  await expect(page.getByText('Welcome to Flowmate. What would you like to talk through or work on?', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Flowmate' })).toBeVisible();
  const rail = page.locator('[data-surface="sidebar"]');
  const search = page.getByRole('button', { name: 'Open command palette' });
  await expect(search).toBeVisible();
  const railRect = await rail.boundingBox(); const searchRect = await search.boundingBox();
  expect(railRect && searchRect && searchRect.x + searchRect.width).toBeLessThanOrEqual((railRect?.x || 0) + (railRect?.width || 0) + 1);
  await expect(search).toHaveAttribute('title', 'Search and commands (Ctrl+K / Cmd+K)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('dashboard borders follow the selected palette instead of retaining green accents', async ({ page }) => {
  for (const palette of ['Forest', 'Ocean', 'Plum', 'Slate']) {
    await navigate(page, 'Settings');
    await page.getByRole('radio', { name: new RegExp('^' + palette) }).click();
    await navigate(page, 'Dashboard');
    if (palette === 'Plum') await page.screenshot({ path: 'qa-evidence/plum-dashboard-theme-borders.png', fullPage: true });
    const colors = await page.evaluate(() => {
      const channels = (color: string) => color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
      const tokenColor = (token: string) => {
        const probe = document.createElement('div');
        probe.style.borderColor = `var(${token})`;
        probe.style.borderStyle = 'solid';
        document.documentElement.append(probe);
        const color = channels(getComputedStyle(probe).borderTopColor);
        probe.remove();
        return color;
      };
      const sidebarActive = document.querySelector('[data-surface="sidebar"] [aria-current="page"]') as HTMLElement;
      const briefing = document.querySelector('[data-testid="dashboard-daily-briefing"]') as HTMLElement;
      const statCards = [...document.querySelectorAll('[data-testid="dashboard-stat-card"]')] as HTMLElement[];
      return {
        accent: tokenColor('--border-accent'),
        hairline: tokenColor('--border-hairline'),
        activeNav: channels(getComputedStyle(sidebarActive).borderTopColor),
        briefing: channels(getComputedStyle(briefing).borderTopColor),
        statCards: statCards.map(card => channels(getComputedStyle(card).borderTopColor)),
      };
    });
    const closeTo = (actual: number[], expected: number[]) => actual.length === 3 && expected.length === 3 && actual.every((channel, index) => Math.abs(channel - expected[index]) <= 16);
    expect(closeTo(colors.activeNav, colors.accent)).toBe(true);
    expect(closeTo(colors.briefing, colors.hairline)).toBe(true);
    expect(colors.statCards).toHaveLength(4);
    expect(colors.statCards.every(color => closeTo(color, colors.hairline))).toBe(true);
    const firstCard = page.getByTestId('dashboard-stat-card').first();
    await firstCard.hover();
    await expect.poll(() => firstCard.evaluate(element => getComputedStyle(element).borderTopColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) || []).then(color => closeTo(color, colors.accent))).toBe(true);
  }
});

test('four palettes govern canvas and route surfaces at desktop tablet and mobile', async ({ page }) => {
  test.setTimeout(300000); mkdirSync('qa-evidence/themes', { recursive: true }); const readings = [];
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const palette of ['Forest', 'Ocean', 'Plum', 'Slate']) {
      await navigate(page, 'Settings'); await page.getByRole('radio', { name: new RegExp('^' + palette) }).click();
      for (const route of ['Dashboard', 'Graph', 'Calendar', 'Analytics', 'Library', 'Chat', 'Settings']) {
        await navigate(page, route);
        const values = await page.evaluate(() => {
          const probe = document.createElement('div'); probe.style.background = 'var(--surface-canvas)'; document.body.append(probe);
          const expected = getComputedStyle(probe).backgroundColor; probe.remove();
          const app = document.getElementById('root')!.firstElementChild!;
          return { expected, backgrounds: [document.documentElement, document.body, document.getElementById('root')!, app].map(e => getComputedStyle(e).backgroundColor), overflow: document.documentElement.scrollWidth > innerWidth };
        });
        expect(values.backgrounds).toEqual(Array(4).fill(values.expected)); expect(values.overflow).toBe(false);
        readings.push({ width, palette, route, ...values });
        await page.screenshot({ path: 'qa-evidence/themes/' + palette + '-' + width + '-' + route + '.png', fullPage: true });
      }
    }
  }
  writeFileSync('qa-evidence/theme-computed-styles.json', JSON.stringify(readings, null, 2));
});
