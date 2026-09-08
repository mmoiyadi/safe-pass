/**
 * End-to-end validation of the quickstart scenarios (T135).
 *
 * These are the tests that exercise what a user actually does, through the real interface,
 * against a real server and a real database. They exist because every layer below them can be
 * green while the product is broken — during development the secret list was fully tested and
 * still rendered an empty vault offline, because nothing had ever driven the browser.
 *
 * Scenario numbers refer to specs/001-password-manager/quickstart.md.
 */
import { expect, test } from '@playwright/test';
import {
  addSecureNote,
  lock,
  offlineCacheDump,
  register,
  waitForCachedSecrets,
  unlock,
  unlockInPlace,
  uniqueEmail,
  PASSWORD,
} from './helpers.js';

test.describe.configure({ mode: 'serial' });

test.describe('V1 — zero-knowledge storage', () => {
  const email = uniqueEmail('v1');
  const TITLE = 'e2e-marker-title';
  const BODY = 'e2e-marker-body-hunter2';

  test('registers, stores a secret, and reads it back after locking', async ({ page }) => {
    await register(page, email);
    await addSecureNote(page, TITLE, BODY);

    await lock(page);
    await unlock(page, email);

    // Survived a full lock/unlock cycle: the key was re-derived from the password alone.
    await expect(page.getByText(TITLE, { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test('never puts the plaintext on the wire', async ({ page }) => {
    const bodies: string[] = [];
    page.on('request', (req) => {
      const body = req.postData();
      if (body) bodies.push(body);
    });

    await unlock(page, email);
    await addSecureNote(page, 'wire-check', 'e2e-marker-never-sent');

    const wire = bodies.join('\n');
    expect(wire).not.toContain('e2e-marker-never-sent');
    expect(wire).not.toContain(PASSWORD);
  });
});

test.describe('V2 — auto-lock and key disposal', () => {
  const email = uniqueEmail('v2');

  test('locking discards the keys, not merely the screen', async ({ page }) => {
    await register(page, email);
    await addSecureNote(page, 'v2-secret', 'v2-body');
    await lock(page);

    // Nothing readable is left behind in memory-backed storage after a lock.
    const leftovers = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
    }));
    expect(leftovers.local).not.toContain('v2-body');
    expect(leftovers.session).not.toContain('v2-body');
    expect(leftovers.local).not.toContain(PASSWORD);
  });

  test('refuses the wrong master password without saying which part was wrong', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('textbox', { name: 'Master password' }).fill('not the right password');
    await page.getByRole('button', { name: 'Unlock' }).click();

    // FR-003: one message for a wrong password and an unknown account alike.
    await expect(page.getByText(/do not match an account/i)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('V3 — typed secrets and masking', () => {
  const email = uniqueEmail('v3');

  test('masks a sensitive field until it is revealed', async ({ page }) => {
    await register(page, email);

    await page.getByRole('button', { name: 'New secret' }).click();
    await page.getByRole('button', { name: 'Website Account', exact: true }).click();
    await page.getByRole('textbox', { name: /^Title/ }).fill('v3-account');
    await page.getByRole('textbox', { name: /^Username/ }).fill('someone@example.test');
    await page.getByRole('textbox', { name: /^Password/ }).fill('v3-secret-value');
    await page.getByRole('button', { name: 'Save encrypted' }).click();

    await expect(page.getByText('v3-account', { exact: true })).toBeVisible({ timeout: 20_000 });

    // Fields are in the detail pane now, so the row is selected to reach them (FR-015). The
    // assertion below is unchanged: this is a structural update, not a weakened check (FR-032).
    await page.getByRole('button', { name: /v3-account/ }).first().click();

    // Masked by default, and the value is genuinely absent from the page, not merely styled.
    await expect(page.getByText('v3-secret-value')).toHaveCount(0);
    await page.getByRole('button', { name: /^Reveal/ }).first().click();
    await expect(page.getByText('v3-secret-value')).toBeVisible();
  });
});

test.describe('V4 — search runs on the device', () => {
  const email = uniqueEmail('v4');

  test('filters without asking the server', async ({ page }) => {
    await register(page, email);
    await addSecureNote(page, 'alpha-note', 'first');
    await addSecureNote(page, 'beta-note', 'second');

    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));

    await page.getByRole('searchbox', { name: /search/i }).fill('alpha');
    await expect(page.getByText('alpha-note', { exact: true })).toBeVisible();
    await expect(page.getByText('beta-note', { exact: true })).toHaveCount(0);

    // The server cannot search ciphertext, so it must not have been asked to.
    expect(requests.filter((u) => /search|query=/.test(u))).toHaveLength(0);
  });
});

test.describe('V8 — custom templates need no deploy', () => {
  const email = uniqueEmail('v8');

  test('defines a secret type and uses it immediately', async ({ page }) => {
    await register(page, email);

    await page.getByRole('button', { name: 'Settings' }).click();
    // Six tasks behind an index now: the editor is one panel rather than a section of a
    // stacked page (FR-019). Selector update only.
    await page.getByRole('button', { name: 'Secret types' }).click();
    await page.getByRole('button', { name: 'Define a secret type' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('E2E Router');
    await page.getByRole('textbox', { name: 'Field name' }).fill('Admin URL');

    // Two fields, because removing the last one is refused by design — a secret type with no
    // fields would render nothing.
    await page.getByRole('button', { name: '+ Add a field' }).click();
    await page.getByRole('textbox', { name: 'Field name' }).nth(1).fill('Admin password');

    await page.getByRole('button', { name: 'Create' }).click();

    // Scoped to the list entry: the name also appears as an "add a secret" button once the
    // template exists, which is the very thing the next assertion checks for.
    await expect(page.getByText(/E2E Router · 2 fields/)).toBeVisible({ timeout: 15_000 });

    // Available at once: a new secret type is a row, not a release (Principle V).
    await page.getByRole('button', { name: 'Back to the vault' }).click();
    await page.getByRole('button', { name: 'New secret' }).click();
    await expect(page.getByRole('button', { name: 'E2E Router', exact: true })).toBeVisible();
  });

  test('warns before a change that would strand stored values', async ({ page }) => {
    await unlock(page, email);
    await page.getByRole('button', { name: 'New secret' }).click();
    await page.getByRole('button', { name: 'E2E Router', exact: true }).click();
    await page.getByRole('textbox', { name: /^Title/ }).fill('v8-router');
    await page.getByRole('textbox', { name: /Admin URL/ }).fill('http://192.168.1.1');
    await page.getByRole('textbox', { name: /Admin password/ }).fill('router-admin-secret');
    await page.getByRole('button', { name: 'Save encrypted' }).click();
    await expect(page.getByText('v8-router', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Secret types' }).click();
    await page.getByRole('button', { name: 'Edit' }).first().click();
    // Drops "Admin password", which the stored secret has a value in.
    await page.getByRole('button', { name: 'Remove' }).nth(1).click();
    await page.getByRole('button', { name: /Save as a new version/ }).click();

    // FR-042: named fields and a real count, not "this may affect existing data".
    const warning = page.getByRole('alertdialog');
    await expect(warning).toBeVisible({ timeout: 15_000 });
    // Names the field by its label, not its slug, and gives a real count.
    await expect(warning.getByText('Admin password')).toBeVisible();
    await expect(warning.getByText(/1 secret/)).toBeVisible();
  });
});

test.describe('V9 — offline read', () => {
  /**
   * One test, deliberately.
   *
   * Each Playwright test gets a fresh browser context, and the offline copy lives in IndexedDB
   * — so splitting "cache it" from "read it offline" would have the second test looking at an
   * empty database and passing or failing for the wrong reason. The whole journey has to happen
   * in one context, exactly as it does for a user.
   */
  test('caches ciphertext, reads it with no network, and refuses writes', async ({ page, context }) => {
    const email = uniqueEmail('v9');
    await register(page, email);
    await addSecureNote(page, 'v9-title-marker', 'v9-body-marker');

    // The cache is refreshed in the background after every change; wait for this one to land.
    await waitForCachedSecrets(page, 1);

    // FR-055: what is written to the device is ciphertext and wrapped keys, nothing else.
    const dump = await offlineCacheDump(page);
    expect(dump).not.toContain('v9-body-marker');
    expect(dump).not.toContain('v9-title-marker');
    expect(dump).not.toContain(PASSWORD);

    // Lock, then pull the network. Locking must NOT discard the copy — unlocking later without
    // a network is the entire point of holding it.
    await lock(page);
    await context.setOffline(true);

    // FR-056: the master password is still required; the cached keys are wrapped.
    await unlockInPlace(page, email);

    // FR-054: the vault is readable with no network at all.
    await expect(page.getByText('v9-title-marker', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Offline — reading only/)).toBeVisible();

    // FR-057: nothing is offered that cannot work, and the reason is given.
    await expect(page.getByRole('button', { name: 'Secure Note', exact: true })).toHaveCount(0);
    // Creation now has one entry point, so its absence is the check that matters (FR-007).
    await expect(page.getByRole('button', { name: 'New secret' })).toHaveCount(0);
    await expect(page.getByText(/Adding and editing need a connection/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await context.setOffline(false);
  });

  test('refuses the wrong master password against the cached copy too', async ({ page, context }) => {
    const email = uniqueEmail('v9-wrong');
    await register(page, email);
    await addSecureNote(page, 'v9-guarded', 'body');

    await waitForCachedSecrets(page, 1);

    await lock(page);
    await context.setOffline(true);

    // Being offline must not soften the check: the cache holds nothing that can verify a
    // password, so a wrong one fails in the unwrap exactly as it would online.
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('textbox', { name: 'Master password' }).fill('not the right password');
    await page.getByRole('button', { name: 'Unlock' }).click();

    await expect(page.getByText(/does not open the copy stored on this device/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('v9-guarded')).toHaveCount(0);

    await context.setOffline(false);
  });
});

test.describe('V15 — permanent deletion', () => {
  const email = uniqueEmail('v15');

  test('names the secret and says the deletion cannot be undone', async ({ page }) => {
    await register(page, email);
    await addSecureNote(page, 'v15-doomed', 'gone shortly');

    // Delete moved into the detail pane, so the secret is selected first (FR-015). The
    // assertions below are unchanged.
    await page.getByRole('button', { name: /v15-doomed/ }).first().click();
    await page.getByRole('button', { name: 'Delete' }).first().click();

    // FR-053: the confirmation must name what is being deleted and be explicit about finality.
    await expect(
      page.getByRole('heading', { name: /Permanently delete .*v15-doomed/ }),
    ).toBeVisible();
    await expect(page.getByText(/cannot be undone/i).first()).toBeVisible();
  });
});
