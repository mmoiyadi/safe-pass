# Contract: Brand Surfaces

Every place the product names itself, with the exact before and after. This is the checklist SC-001
is verified against.

---

## The name

| # | File | Line | Before | After |
|---|---|---|---|---|
| 1 | `frontend/index.html` | 7 | `<title>Password Manager</title>` | `<title>Cairn</title>` |
| 2 | `frontend/public/manifest.webmanifest` | 2 | `"name": "Password Manager"` | `"name": "Cairn"` |
| 3 | `frontend/public/manifest.webmanifest` | 3 | `"short_name": "Vault"` | `"short_name": "Cairn"` |
| 4 | `frontend/src/features/shell/VaultRail.tsx` | 249 | `Password Manager` in `Brand()` | the lockup — mark tile plus `Cairn` |
| 5 | `frontend/src/crypto/totp.ts` | 94 | `params.issuer ?? 'Password Manager'` | `params.issuer ?? 'Cairn'` |
| 6 | `frontend/src/features/settings/backup.tsx` | 79 | `` `vault-backup-${date}.json` `` | `` `cairn-backup-${date}.json` `` |
| 7 | `backend/src/modules/activity/mailer.ts` | 49 | `From: Password Manager <...>` | `From: Cairn <...>` |

`description` in the manifest is **unchanged** (FR-005). It describes what the product does, names
nothing, and is well written.

---

## Explicitly out of scope

Not product names. Renaming any of them is a migration, not a rebrand (FR-003).

| | Stays |
|---|---|
| `frontend/package.json` `"name": "frontend"` | Workspace identifier |
| Database name, roles, env-var names | Migration surface |
| Render service name (`safe-pass`) and its URL | FR-015 — deploy plumbing; renaming breaks every bookmark and sent link to change a string no user reads |
| `no-reply@passwordmanager.local` | Not user-visible today; replaced wholesale when a real mail provider is configured (spec discrepancy 7) |
| `README.md`, `.specify/memory/constitution.md` | Developer-facing documents, not product surfaces |
| `frontend/tests/crypto/totp.test.ts:147` | Passes `issuer` explicitly; pins percent-encoding of a name with a space, not the product name (research §4) |

---

## The shell

| File | Key | Before | After |
|---|---|---|---|
| `frontend/index.html` | `<meta name="theme-color">` | `#12141a` | `#c67139` |
| `manifest.webmanifest` | `theme_color` | `#12141a` | `#c67139` |
| `manifest.webmanifest` | `background_color` | `#12141a` | `#f5ead8` |

---

## Icons

Copied from `design_handoff_vault_workbench/brand/` into `frontend/public/`.

| File | Action | Referenced by |
|---|---|---|
| `icon-192.png` | replace | manifest |
| `icon-512.png` | replace | manifest |
| `icon-maskable-512.png` | replace | manifest, `purpose: maskable` |
| `favicon.svg` | **new** | `index.html` — no scalable tab icon today |
| `favicon-32.png` | **new** | `index.html` — fallback |
| `favicon-16.png` | **new** | available to the browser at the smallest size |
| `apple-touch-icon-180.png` | **new** | `index.html` — currently points at the 192 PNG, which iOS rescales badly |
| `icon-512-sage.png`, `app-icon-512-sage.svg` | **not shipped** | nothing — FR-013a |

### `index.html` link changes

```html
<!-- repointed: was /icon-192.png -->
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png" />
<!-- new -->
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
```

No service-worker change. `injectManifest`'s `globPatterns` already cover `png` and `svg`, so
Workbox re-revisions replaced files on the next build (research §8).

---

## The second-factor issuer, stated carefully

This is the only surface where a rename touches something that outlives the application's own
state, so the guarantee is worth writing down rather than assuming.

- The issuer is embedded in the `otpauth://` URI **at enrolment** and stored by the user's
  authenticator app as a label.
- Verification computes a code from the shared secret and the current time step. **The issuer is
  not an input.**
- Therefore: an enrolment made before the rename keeps its old label and keeps verifying. Only new
  enrolments carry the new name.

FR-004 requires both halves, and SC-006 verifies the second. The test that proves it is written
**before** the default changes (Constitution IV), because "we changed a label near the second
factor and nothing broke" is exactly the claim that deserves evidence rather than confidence.
