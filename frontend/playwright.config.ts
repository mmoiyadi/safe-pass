import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,

  /**
   * Argon2id at 64 MiB is deliberately slow — that is the whole point of it — and a flow that
   * registers, locks, and unlocks runs it several times. Playwright's 30-second default is
   * tuned for apps that do no key derivation at all, and failed here for no reason but arithmetic.
   */
  timeout: 120_000,
  expect: { timeout: 30_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // http, not https: the dev server does not terminate TLS. TLS is a deployment requirement
  // (docs/operations.md), not something these tests can or should assert against localhost.
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },

  // Started for the run, reused if one is already up — so `pnpm dev` in another terminal is
  // not a reason for the suite to fail or to start a second, conflicting server.
  webServer: {
    // Rate limiting off for the run: this suite registers and signs in far more than ten times
    // in fifteen minutes, so the limiter correctly refuses it. It is tested on its own in
    // backend/tests/security/rate-limit.test.ts, and the flag is ignored in production.
    command: 'RATE_LIMIT=off bash ../scripts/dev.sh',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
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
