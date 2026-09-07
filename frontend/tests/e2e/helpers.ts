/**
 * Shared steps for the end-to-end suite.
 *
 * Every account is created through the real registration form: these tests exist to exercise
 * the paths a user actually takes, and seeding an account directly would skip the one flow
 * (registration, with its no-recovery acknowledgement) that everything else depends on.
 */
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'correct horse battery staple';

/** Unique per run, so a suite re-run does not collide with its own leftovers. */
export const uniqueEmail = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.test`;

export async function register(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a new vault' }).click();

  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('textbox', { name: 'Master password', exact: true }).fill(PASSWORD);
  await page.getByRole('textbox', { name: 'Confirm master password' }).fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I understand/ }).check();

  await page.getByRole('button', { name: 'Create vault' }).click();
  await expect(page.getByRole('heading', { name: email })).toBeVisible({ timeout: 30_000 });
}

/**
 * Signs in without navigating.
 *
 * The Vite dev server does not serve the service worker, so a `goto` with the network off
 * cannot fetch the app shell — that part of FR-050 needs the production build. Locking already
 * returns to the unlock screen within the running app, so an offline test can sign in from
 * there and exercise the thing under test: unlocking from the device's cached copy.
 */
export async function unlockInPlace(page: Page, email: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('textbox', { name: 'Master password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: email })).toBeVisible({ timeout: 60_000 });
}

export async function unlock(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('textbox', { name: 'Master password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: email })).toBeVisible({ timeout: 30_000 });
}

export async function lock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your vault' })).toBeVisible();
}

/** Stores a Secure Note, the simplest built-in type. */
export async function addSecureNote(page: Page, title: string, body: string): Promise<void> {
  await page.getByRole('button', { name: 'Secure Note', exact: true }).click();
  await page.getByRole('textbox', { name: /^Title/ }).fill(title);
  await page.getByRole('textbox', { name: /^Note/ }).fill(body);
  await page.getByRole('button', { name: 'Save encrypted' }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 });
}

/**
 * Waits until the device's cached copy actually holds the expected number of secrets.
 *
 * Polling on "is there a snapshot at all" is not enough: one written earlier in the session is
 * already non-empty, so the check passes against stale data and the offline assertions then
 * fail for a reason that has nothing to do with what they are testing.
 */
export async function waitForCachedSecrets(page: Page, atLeast: number): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const snapshot = JSON.parse(await offlineCacheDump(page)) as {
            vaults?: Array<{ secrets?: unknown[] }>;
          } | null;
          return snapshot?.vaults?.[0]?.secrets?.length ?? 0;
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(atLeast);
}

/** Everything the page has written to IndexedDB, as one searchable string. */
export async function offlineCacheDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('pm-offline', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const snapshot = await new Promise<unknown>((res) => {
      const r = db.transaction('snapshot', 'readonly').objectStore('snapshot').get('current');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    return JSON.stringify(snapshot ?? null);
  });
}
