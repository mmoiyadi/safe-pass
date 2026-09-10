# Data Model: Cairn Rebrand

**No persisted data changes.** No table, column, index, migration, or serialised format is
touched. This section exists to say that precisely, and to name the constants that do carry the
brand — because "where does the name live" is the question this feature is about.

---

## What does not change

| | |
|---|---|
| Database schema | Untouched. No migration ships with this feature. |
| Backup export format | Untouched. The envelope is `formatVersion: 1`, `exportedAt`, `vault`, `keyWraps`, `secrets`, `folders`, `tags` — nothing identifies the application. A backup taken before the rename restores after it, byte-identically (SC-006a). |
| Session, cookie and token shapes | Untouched. |
| Encrypted payloads and key wrapping | Untouched. |
| Template and field definitions | Untouched. |

The one place a rename could plausibly have reached persisted data is the second-factor issuer,
and it does not: the issuer is written into an `otpauth://` URI **at enrolment**, handed to the
user's authenticator app, and never stored server-side as an identity. Verification derives a code
from the shared secret and the current time step. See [contracts/brand-surfaces.md](./contracts/brand-surfaces.md).

---

## The brand as data

Four values, each read from exactly one place.

### Product name

**Value**: `Cairn`

| Read by | Surface | Persisted? |
|---|---|---|
| `frontend/index.html` | Browser tab title | No |
| `frontend/public/manifest.webmanifest` | Installed app name and short name | By the platform, at install |
| `frontend/src/features/shell/VaultRail.tsx` | The rail's brand row | No |
| `frontend/src/crypto/totp.ts` | Second-factor issuer, at enrolment | **In the user's authenticator app**, permanently, per enrolment |
| `frontend/src/features/settings/backup.tsx` | Downloaded backup filename | In the user's filesystem |
| `backend/src/modules/activity/mailer.ts` | `From` display name on outbound mail | In the recipient's mailbox |

Three of those six outlive the application's own state: an authenticator entry, a downloaded file,
and a delivered email. Only the first is a correctness concern, and FR-004 covers it — an
enrolment made under the old name must keep verifying, because its label is decoration and its
secret is not.

### Shell colours

| Constant | Was | Becomes | Read by |
|---|---|---|---|
| Chrome tint | `#12141a` | `#c67139` (`--color-accent`) | `index.html` meta, manifest `theme_color` |
| Splash ground | `#12141a` | `#f5ead8` (`--color-bg`) | manifest `background_color` |

Both old values are residue from the dark palette the workbench redesign removed. They are not
tokens — they are literals in HTML and JSON, which is why they survived a change that deleted the
theme they belonged to.

### Mark geometry

Three variants, each a short list of ellipses on a 48×48 grid, transcribed into
`frontend/src/components/Mark.tsx` and read by nothing else (FR-009). Exact values in
[contracts/mark-component.md](./contracts/mark-component.md).

Not data in any storage sense — but it behaves like a schema in one respect: the per-stone `cx`
offsets (24, 23, 25, 23) *are* the mark, and FR-011 forbids centring them. A well-meaning tidy-up
would be a silent brand change, so the contract states them explicitly rather than leaving them to
be read off a file.

### Icon set

Seven files under `frontend/public/`, referenced by `index.html` and the manifest. Three replace
existing files at the same paths; four are new. The sage variant is not among them (FR-013a).

Content-addressed by the service worker's precache manifest, so replacing a file at the same path
is enough for Workbox to re-revision it — no cache-name bump, no code change.
