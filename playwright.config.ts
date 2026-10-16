import { defineConfig } from '@playwright/test';
const productionOffline = Boolean(process.env.FLOWMATE_PRODUCTION_OFFLINE);
const baseURL = process.env.FLOWMATE_TEST_ORIGIN || 'http://127.0.0.1:4195';
export default defineConfig({
  testDir: './browser-tests', workers: 1, retries: 0, timeout: 60000,
  expect: { timeout: 10000 }, outputDir: 'qa-evidence/artifacts',
  reporter: [['list'], ['json', { outputFile: 'qa-evidence/browser-results.json' }]],
  use: { baseURL, channel: 'chrome', headless: true,
    viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: productionOffline ? 'allow' : 'block' },
  webServer: productionOffline ? {
    command: 'npm run preview -- --host 127.0.0.1 --port 4196 --strictPort',
    url: baseURL, reuseExistingServer: true, timeout: 30000,
  } : {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4195 --strictPort',
    url: baseURL, reuseExistingServer: true, timeout: 30000,
  },
});
