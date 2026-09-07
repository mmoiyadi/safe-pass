# Quickstart — validating the redesign

How to prove each part works, in the order the work is done. Every step is runnable; each maps to
requirements in [spec.md](./spec.md) and behaviours in
[contracts/preserved-behaviour.md](./contracts/preserved-behaviour.md).

## Prerequisites

```sh
docker compose up -d                                   # PostgreSQL + Mailpit
pnpm install
pnpm --filter backend exec prisma migrate deploy --schema src/db/schema.prisma
RATE_LIMIT=off bash scripts/dev.sh                     # http://localhost:5173
```

`RATE_LIMIT=off` is for repeated manual sign-ins during review. It is ignored when
`NODE_ENV=production`.

Seed a vault worth looking at: at least 24 secrets across three template types, several folders,
several tags, and one secret carrying custom fields. A vault of three secrets will not show
whether the list is scannable, which is the point of V1.

---

## V0 — Characterisation tests pass before anything changes

**Principle IV gate. Do this first; it is the only way to know later that nothing broke.**

```sh
pnpm --filter frontend test tests/unit/auto-lock.test.ts
pnpm --filter frontend test tests/unit/sensitive-field.test.tsx
pnpm --filter frontend test tests/unit/copy-button.test.tsx
```

**Expected**: all pass against the **current, unmodified** components. A test that only passes
after the redesign proves nothing about preservation.

Covers: the 12-bullet mask, the 30s re-hide, the 30s clipboard clear, all three acknowledgement
strings, both `aria-label` formats, the lock deadline, the null-when-locked case, and the
unchanged 15-minute ceiling.

---

## V1 — Theme swap changes nothing but colour

After step 1 of the work order.

1. Open the app and sign in.
2. Walk every screen: unlock, vault, organise, sharing, settings, register, forgot password.

**Expected**: everything is warmer — cream ground, terracotta buttons. Nothing is missing,
overlapping, or unreadable. The legacy aliases (`--bg`, `--fg`, `--muted`, `--border`, `--accent`,
`--danger`, `--warn`) carry the not-yet-rewritten components.

```sh
pnpm -r typecheck && pnpm --filter frontend test
```

**Also confirm**: `frontend/index.html` declares `color-scheme: light`, and a browser set to
prefer dark shows light form controls rather than dark ones on cream.

---

## V2 — One rail, and filtering still means what it meant

After step 2. Maps to User Story 2.

1. With two vaults, switch between them from the rail.
2. Select a folder → the list narrows; select another → the first deselects (exclusive).
3. Select two tags → only secrets carrying **both** remain.
4. Select "Unfiled" → only secrets with no folder.
5. With any filter active, use "Clear filters"; confirm the link is absent when nothing is active.
6. Leave the vault idle and watch the countdown chip decrease.

**Expected**: the account bar, vault-switcher strip, tab strip and filter strip are all gone. The
page does not shift when a notice appears.

**The one to actually test**: leave the tab open with the countdown running and confirm the vault
still locks on schedule. The chip must not keep the session alive.

---

## V3 — The list is scannable and the detail pane is the only place fields live

After step 3. Maps to User Story 1 and SC-001.

1. Open a 24-secret vault at 1440×900.
2. Count what fits without scrolling.
3. Click a row; read its fields in the detail pane.
4. Reveal a sensitive field; wait 30 seconds.
5. Copy a field; watch the countdown; wait for the acknowledgement.
6. File the secret into a folder and toggle a tag — both from the detail pane.
7. Filter so the selected secret disappears.

**Expected**:
- Every secret is one line. **No field value appears in any row** beyond the single summary value,
  and never a sensitive one.
- All 24 are visible without scrolling (SC-001).
- The revealed value re-masks itself after 30 s, as 12 bullets.
- The clipboard acknowledgement reads verbatim `copied — clipboard clears in {n}s`, then
  `clipboard cleared`.
- When the selected secret is filtered away, the detail pane returns to its empty prompt — it does
  not keep showing a secret that is no longer listed.

---

## V4 — Icon buttons kept their labels

After step 4.

```sh
pnpm --filter frontend test tests/unit/sensitive-field.test.tsx tests/unit/copy-button.test.tsx
```

**Expected**: the same tests from V0 still pass, unchanged. Then in the browser, with the
accessibility tree open, confirm the reveal button is named `Reveal {field}` and the copy button
`Copy {field}` — not "button", and not the icon's name.

---

## V5 — One settings task at a time

After step 5. Maps to User Story 3.

1. Open settings. Confirm one panel is shown and six are listed.
2. Visit each of the six.
3. Return to the vault, then re-open settings — it starts at Master password again.
4. Confirm a badge appears beside a row **only** when its data has loaded (backup codes remaining,
   offline on/off, failed sign-in count), and nothing is shown in its place otherwise.
5. With an unverified address, confirm verification is still a banner, not a settings panel.

---

## V6 — The countdown is a display, never a mechanism

After step 6.

```sh
pnpm --filter frontend test tests/unit/auto-lock.test.ts
```

Then: set the auto-lock low, leave the tab untouched with the chip visible, and confirm the vault
locks exactly when the chip reaches zero — and that every pane becomes unreachable in the same
instant.

---

## V7 — Undrawn screens use the same vocabulary

After step 7. Walk: register, forgot password, TOTP step, verify landing, reauth prompt,
`TemplateForm`, `Organise`, `Sharing`, `Backup`, `OfflineAccess`, the delete dialog and the folder
dialog.

**Expected**: each is built from the seven parts — pane, pill row, pill input, primary button,
secondary button, chip, notice. No new colour appears. Both dialogs keep their copy, and the
folder dialog still demands an explicit choice with **nothing pre-selected**.

---

## V8 — 360px, measured rather than assumed

After step 8. Maps to User Story 4 and SC-004.

```sh
pnpm --filter frontend exec playwright test --project=mobile-360
```

Then in the browser at 360×760, on every screen:

```js
// horizontal overflow
[...document.querySelectorAll('main *')]
  .filter(el => el.getBoundingClientRect().right > innerWidth + 1)

// touch targets below 44px
[...document.querySelectorAll('button, a, input, select, [role="button"]')]
  .filter(el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.height < 44; })
  .map(el => [el.tagName, el.textContent?.trim().slice(0, 30), Math.round(el.getBoundingClientRect().height)])
```

**Expected**: both arrays empty.

**Note**: the second check is new. The current stylesheet sets 36px and no test has ever measured
it, so this is the first time the 44px guarantee is actually verified rather than asserted.

---

## V9 — Full sweep

```sh
pnpm -r typecheck
pnpm lint
pnpm -r build
pnpm -r test
pnpm --filter frontend exec playwright test
```

**Expected**: all green. End-to-end changes are limited to selectors — the control formerly named
"Close settings" is now "Back to the vault", and the per-template buttons are now one "New
secret". **No assertion about behaviour may be removed to make a test pass.**

---

## V10 — Offline still renders correctly, in the right typefaces

1. Load the vault so the offline copy refreshes.
2. Lock.
3. DevTools → Network → Offline.
4. Unlock.

**Expected**: the vault opens from the cached copy; the offline notice shows; New secret, Edit,
Delete, filing and tagging are all absent; the explanation about nothing being queued is verbatim.

**And the reason fonts were vendored**: headings render in Caprasimo and body text in Figtree, not
fallback faces. A `@import` from Google Fonts would fail here silently.
