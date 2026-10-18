import { defineConfig } from '@playwright/test';
const productionOffline = Boolean(process.env.FLOWMATE_PRODUCTION_OFFLINE);
const testPort = Number(process.env.FLOWMATE_TEST_PORT || 4195);
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) {
  throw new Error('FLOWMATE_TEST_PORT must be an available unprivileged TCP port');
}
const baseURL = process.env.FLOWMATE_TEST_ORIGIN || `http://127.0.0.1:${testPort}`;
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
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: baseURL, reuseExistingServer: true, timeout: 30000,
    // Local browser tests must fail closed to the demo emulators. A missing
    // flag must never send Auth or Firestore requests to a real Firebase project.
    env: {
      ...process.env,
      VITE_FIREBASE_API_KEY: 'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-flowmate-next.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-flowmate-next',
      VITE_FIREBASE_STORAGE_BUCKET: 'demo-flowmate-next.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:demo',
      VITE_FIREBASE_EMULATORS: 'true',
      VITE_FIREBASE_APPCHECK_SITE_KEY: '',
      VITE_FIREBASE_MEASUREMENT_ID: '',
      VITE_MANAGED_AI_ENDPOINT: '',
      VITE_GEMINI_API_KEY: '',
    },
  },
});
