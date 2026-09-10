# Research: Cairn Rebrand

Phase 0. Every unknown in the plan's Technical Context resolved, plus the things that looked
settled and were not.

---

## 1. The mark's source files are 94% metadata

**Finding**: each supplied SVG is ~8 KB, of which **7,736 bytes is a C2PA provenance manifest**
in a `<metadata>` block. The drawable geometry is 125–283 bytes: four ellipses in the full mark,
three in the small, two in the micro.

| File | Total | Metadata | Geometry | Shapes |
|---|---|---|---|---|
| `cairn-mark.svg` | 8,241 B | 7,736 B | 283 B | 4 |
| `cairn-mark-small.svg` | 8,141 B | 7,736 B | 196 B | 3 |
| `cairn-mark-micro.svg` | 8,057 B | 7,736 B | 125 B | 2 |
| `cairn-mark-solid.svg` | 8,211 B | 7,736 B | 253 B | 4 |

**Decision**: transcribe the **geometry** into the component, not the files. Three inline variants
of a few ellipses each, roughly 600 bytes total.

**Rationale**: the handoff asks for the marks inlined so they cost no request and are present at
first paint (FR-008). Inlining them verbatim would put ~23 KB of base64 provenance data into a
component that renders on every screen, to no purpose — C2PA describes how the file was authored,
which is meaningful for the file in the handoff folder and meaningless once the shapes are React
elements.

**Alternatives considered**: importing the SVGs as URLs (fails FR-008 — a request, and not present
at first paint); a build-time SVG-to-component plugin (a new dependency and a new build step for
four ellipses); stripping metadata at build time (same outcome as transcription, with machinery).

---

## 2. Exact geometry, so the component is not a guess

All three share `viewBox="0 0 48 48"` and `fill="currentColor"`.

**Full** (≥32px) — four stones, alternating weight via `opacity="0.62"` on the 2nd and 4th:

```
cx=24   cy=38    rx=13    ry=4.6
cx=23   cy=28.4  rx=10    ry=4.2   opacity 0.62
cx=25   cy=20    rx=7     ry=3.8
cx=23   cy=12.2  rx=3.75  ry=3.6   opacity 0.62
```

**Small** (20–31px) — three stones, all full weight:

```
cx=24   cy=38    rx=13.5  ry=5.2
cx=22.4 cy=27.4  rx=9.6   ry=4.8
cx=25   cy=16.6  rx=5.4   ry=4.6
```

**Micro** (<20px) — two stones, larger and rounder:

```
cx=24   cy=36    rx=15    ry=6.6
cx=23   cy=20    rx=8.6   ry=6.4
```

Note the alternating opacity exists **only** in the full mark. Small and micro are flat, because
at those sizes a 62% stone reads as a rendering artefact rather than a design.

The `cx` values differ per stone (24, 23, 25, 23) and that is the mark: FR-011 forbids centring
them. They must be transcribed exactly, not tidied.

---

## 3. The clear-space rule and the rail tile do not conflict

**Question**: FR-011 requires clear space on all four sides equal to the top stone's height. The
handoff also specifies a 34px tile holding a 20px mark. Do those contradict?

**Finding**: no, comfortably. Computed from the geometry at the specified sizes:

| | Value at a 20px mark in a 34px tile |
|---|---|
| Required clear space (top stone height, 7.2/48) | **3.0 px** |
| Actual, top | 10.6 px |
| Actual, bottom | 9.3 px |
| Actual, left and right | 11.6 px |

**Decision**: build the lockup as the handoff draws it. No adjustment needed.

**Why it was checked**: two rules from the same document, one geometric and one numeric, are
exactly where a handoff contradicts itself. This one does not, and knowing that is cheaper than
discovering it during review.

---

## 4. Changing the second-factor issuer is safe

**Finding**: `frontend/src/crypto/totp.ts:94` defaults `issuer` to `'Password Manager'`. The
issuer is written into the `otpauth://` URI **at enrolment** and becomes a label inside the user's
authenticator app. Verification computes a code from the shared secret and the time step; the
issuer plays no part in it.

**Decision**: change the default. Existing enrolments keep their old label and keep verifying;
only new enrolments carry the new name. FR-004 states both halves.

**Related finding**: `frontend/tests/crypto/totp.test.ts:147` passes `issuer: 'Password Manager'`
**explicitly** rather than relying on the default, and asserts `issuer=Password%20Manager` in the
URI. That test pins percent-encoding of a name containing a space, not the product name — so it
must be **left alone**. Changing it to `Cairn` would quietly delete the encoding case it exists
to cover.

---

## 5. Only one test asserts the product name

Searched the whole tree. `frontend/tests/unit/vault-rail.test.tsx:186` asserts
`getByText('Password Manager')` and that `'Keyhouse'` is absent — written for FR-022a of the
previous feature, which this one supersedes.

**Decision**: update that assertion to the new name and keep its shape, including the negative.
No other test changes. Nothing in the e2e suite selects on the product name.

---

## 6. The backup file carries no product name; the download filename does

**Finding**: the export envelope is `formatVersion`, `exportedAt`, `vault`, `keyWraps`, `secrets`,
`folders`, `tags`. Nothing identifies the application. Import validates structure and never reads
a name.

The handoff lists "the backup file header" among places the word appears. It is not there.

**Decision**: no format change, and therefore **no backup-compatibility risk**. The one thing that
does carry the old name is the download filename in `frontend/src/features/settings/backup.tsx:79`
— `vault-backup-<date>.json` — which FR-002a renames. Restoring is unaffected because import reads
contents, never the filename.

---

## 7. What `index.html` is missing, precisely

Current: a `<title>`, a manifest link, one PNG favicon at 192, an `apple-touch-icon` pointed at
that same 192 PNG, and `theme-color: #12141a`.

| Change | Why |
|---|---|
| `<title>` → `Cairn` | FR-002 |
| Add `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` | Scalable tab icon; none today |
| Add `<link rel="icon" href="/favicon-32.png" sizes="32x32">` | Fallback where SVG icons are unsupported |
| Repoint `apple-touch-icon` → `/apple-touch-icon-180.png` | It currently points at the 192 PNG, which iOS rescales badly |
| `theme-color` `#12141a` → `#c67139` | FR-014 |

`#12141a` is a leftover from the dark palette the workbench redesign removed. It tints browser
chrome near-black against a cream page.

---

## 8. Icon replacement needs no service-worker change

**Finding**: `frontend/vite.config.ts` uses `injectManifest` with
`globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}']`. Workbox hashes each precached
file, so replacing a PNG at the same path changes its revision and the next build ships a new
manifest. No cache-name bump, no code change.

**But**: `registerType: 'prompt'` means a new service worker does not activate on its own — it
waits for the user to accept the confirm in `main.tsx`. A returning visitor keeps the old icons
and the old name until they do. That is the application's existing, deliberate update path, and
FR-018 requires the rebrand to travel on it rather than around it.

**Decision**: change nothing about the service worker. Verify the offline flow after the first
post-deploy reload (quickstart V6) rather than assuming Workbox handled it.

---

## 9. Assets verified against their filenames

Every supplied PNG is the size its name claims: `favicon-16` 16×16, `favicon-32` 32×32,
`icon-192` 192×192, `apple-touch-icon-180` 180×180, `icon-512` and `icon-maskable-512` 512×512.
No re-cutting needed.

The sage pair (`icon-512-sage.png`, `app-icon-512-sage.svg`) is not shipped — FR-013a. Verified it
is referenced by nothing in the handoff beyond the asset tables.

---

## 10. The handoff's font section is already done

Handoff §4 asks for Caprasimo and Figtree to be self-hosted from `public/fonts/` rather than
imported from a font CDN, and precached. That shipped with the vault workbench redesign: four
woff2 files are in `frontend/public/fonts/` with their OFL licences, `@font-face`d from
`theme.css`, and present in the precache manifest.

**Decision**: no work. Recorded so nobody re-does it from the handoff.
