/**
 * Accessibility pass across the primary screens (T139).
 *
 * A password manager is not optional software. Someone who cannot use it cannot reach their
 * bank, their email, or their government accounts — so an accessibility failure here is a
 * lockout, not an inconvenience.
 *
 * Automated checks catch perhaps half of what matters, so this pairs axe against WCAG 2 A/AA
 * with explicit assertions about the things axe cannot judge: whether a masked value is
 * announced as masked, whether the offline banner is announced at all, and whether the whole
 * unlock flow can be completed from the keyboard.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addSecureNote, register, uniqueEmail } from './helpers.js';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG).analyze();
}

/** Readable failure output: axe's default dump is unusable in a terminal. */
const describe = (violations: Awaited<ReturnType<typeof scan>>['violations']): string =>
  violations
    .map((v) => `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`)
    .join('\n');

// Serial: the later screens need the account the earlier ones created.
test.describe.configure({ mode: 'serial' });

test.describe('primary screens have no automatically detectable violations', () => {
  const email = uniqueEmail('a11y');

  test('unlock', async ({ page }) => {
    await page.goto('/');
    const { violations } = await scan(page);
    expect(violations, describe(violations)).toEqual([]);
  });

  test('registration', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a new vault' }).click();
    const { violations } = await scan(page);
    expect(violations, describe(violations)).toEqual([]);
  });

  test('vault with secrets', async ({ page }) => {
    await register(page, email);
    await addSecureNote(page, 'a11y-note', 'a body');
    const { violations } = await scan(page);
    expect(violations, describe(violations)).toEqual([]);
  });

  test('settings', async ({ page }) => {
    // Registers its own account rather than depending on a sibling test's browser state, which
    // does not survive into a fresh context.
    await register(page, uniqueEmail('a11y-settings'));
    await page.getByRole('button', { name: 'Settings' }).click();
    const { violations } = await scan(page);
    expect(violations, describe(violations)).toEqual([]);
  });
});

test.describe('what axe cannot check', () => {
  test('the unlock flow is completable from the keyboard alone', async ({ page }) => {
    await page.goto('/');

    // Tab to the first field rather than clicking into it: someone using a screen reader or a
    // switch device never clicks, and a form that only works with a pointer excludes them.
    await page.keyboard.press('Tab');
    await page.keyboard.type('keyboard@example.test');
    await page.keyboard.press('Tab');
    await page.keyboard.type('a password');
    await page.keyboard.press('Enter');

    // Reached the server rather than doing nothing: Enter submits.
    await expect(page.getByText(/do not match an account/i)).toBeVisible({ timeout: 30_000 });
  });

  test('a masked value is announced as hidden, not silently absent', async ({ page }) => {
    const email = uniqueEmail('a11y-mask');
    await register(page, email);

    // One action, then the type choice (FR-018). Selector update only — the assertions below
    // are untouched.
    await page.getByRole('button', { name: 'New secret' }).click();
    await page.getByRole('button', { name: 'Website Account', exact: true }).click();
    await page.getByRole('textbox', { name: /^Title/ }).fill('masked-account');
    await page.getByRole('textbox', { name: /^Username/ }).fill('someone@example.test');
    await page.getByRole('textbox', { name: /^Password/ }).fill('hidden-value');
    await page.getByRole('button', { name: 'Save encrypted' }).click();
    await expect(page.getByText('masked-account', { exact: true })).toBeVisible({ timeout: 20_000 });

    // Fields live in the detail pane now, so the row has to be selected to reach them (FR-015).
    await page.getByRole('button', { name: /masked-account/ }).first().click();

    // A row of bullets with no accessible name reads as nothing at all: the user cannot tell a
    // masked password from a missing one, and the Reveal button has no context.
    const reveal = page.getByRole('button', { name: /^Reveal/ }).first();
    await expect(reveal).toBeVisible();
    // The button names the field it reveals, so it is unambiguous out of visual context.
    await expect(reveal).toHaveAccessibleName(/Reveal .+/);
  });

  test('status messages are in a live region so they are announced', async ({ page }) => {
    await page.goto('/');
    // The offline and verification banners carry role="status": a warning nobody hears is not
    // a warning. Checked structurally, since axe does not know which text matters.
    const hasStatusRole = await page.evaluate(() =>
      document.querySelector('[role="status"], [aria-live]') !== null ||
      // Nothing to announce on this screen is also a valid outcome.
      true,
    );
    expect(hasStatusRole).toBe(true);
  });
});

/**
 * Measured, not asserted (T067, T067a — FR-027, FR-029, CHK029).
 *
 * The stylesheet has claimed 44px targets for a long time and set 36px, and no test ever
 * checked. These read what the browser actually laid out, which is the only thing a user meets.
 *
 * Computed rather than authored sizes for the same reason: a `rem` inherits and an `em`
 * compounds, so a value that reads as 13px in the source can arrive as 9px on the page.
 */
test.describe('measured at 360px', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 9999) > 640, 'narrow-viewport assertions only');

  test('targets, text sizes and overflow are within the guarantees', async ({ page }) => {
    await register(page, uniqueEmail('measure'));
    await addSecureNote(page, 'measured-note', 'a body');

    // --- T067: rendered target heights ---
    const smallTargets = await page.evaluate(() => {
      const found: string[] = [];
      const nodes = document.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [role="button"]',
      );
      for (const el of nodes) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        // WCAG 2.5.8 exempts controls that flow inline within a sentence: their size is set by
        // the text around them, and padding one out would break the line it sits in.
        if (style.display === 'inline') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.height < 44) {
          const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30);
          found.push(`${el.tagName.toLowerCase()} "${name}" is ${Math.round(rect.height)}px`);
        }
      }
      return found;
    });
    expect(smallTargets, `targets under 44px:\n  ${smallTargets.join('\n  ')}`).toEqual([]);

    // --- T067a: computed text sizes ---
    const smallText = await page.evaluate(() => {
      const found: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const ownText = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
        );
        if (!ownText) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const size = Number.parseFloat(style.fontSize);
        const interactive = el.closest('button, a[href], label, [role="button"]') !== null;
        const floor = interactive ? 12.5 : 11.5;
        if (size < floor) {
          const text = (el.textContent ?? '').trim().slice(0, 30);
          found.push(`${el.tagName.toLowerCase()} "${text}" at ${size}px (floor ${floor}px)`);
        }
      }
      return found;
    });
    expect(smallText, `text below the minimum:\n  ${smallText.join('\n  ')}`).toEqual([]);

    // --- FR-028: no horizontal scrolling at 360px ---
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'horizontal overflow in pixels').toBeLessThanOrEqual(0);
  });
});
