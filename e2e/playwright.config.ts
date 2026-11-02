import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests: the real server (fresh database, made-up teams) serving the built web app.
 * Build the web app first (web: npm run build), then: npm test.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './setup.ts',
  globalTeardown: './teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3977',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
