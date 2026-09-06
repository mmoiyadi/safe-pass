import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'https://localhost:5173', trace: 'on-first-retry', ignoreHTTPSErrors: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Quickstart V9/V11: read a vault with the network fully disabled.
    { name: 'offline', use: { ...devices['Desktop Chrome'], offline: true } },
    // Quickstart V5/V12/V13 need two accounts acting on one vault at once.
    { name: 'multi-account', use: { ...devices['Desktop Chrome'] } },
    // SC-009: every primary task completable at 360px.
    { name: 'mobile-360', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } } },
  ],
});
