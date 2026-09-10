# Quickstart: Verifying the Cairn Rebrand

Seven scenarios. Each states what to run, what to look at, and what would count as a failure.

**Prerequisites**: PostgreSQL running (`pnpm db:up`), a `.env` (see `docs/operations.md`), and
`pnpm install --frozen-lockfile`. Start with `pnpm dev`.

---

## V0 — The issuer guarantee, before anything changes

**Constitution IV.** Run first, against the unmodified `totp.ts`.

```sh
pnpm --filter frontend exec vitest run tests/unit/totp-issuer
```

**Expect**: passing. It pins that a URI built with one issuer and a code verified against that
enrolment's secret are independent — the issuer is a label, not an input to verification.

**Failure would mean**: the issuer participates in verification after all, and FR-004's promise
that existing second factors keep working is unfounded. Stop; the rename cannot proceed as
specified.

---

## V1 — The name, everywhere a user reads it

```sh
pnpm -r build
grep -ri "password manager" frontend/dist/ || echo "clean"
```

**Expect**: `clean`. Then, in the running app:

| Surface | Expect |
|---|---|
| Browser tab | `Cairn` |
| Rail brand row | The mark in a terracotta tile, then `Cairn` |
| Settings → Backup → export | Downloads as `cairn-backup-<date>.json` |

**Failure**: any occurrence in `dist/` outside the exclusions in
[contracts/brand-surfaces.md](./contracts/brand-surfaces.md) means a surface was missed.

---

## V2 — The mark at every size it appears

```sh
pnpm --filter frontend exec vitest run tests/unit/mark
```

**Expect**: passing — 2 stones below 20px, 3 from 20 to 31, 4 from 32 up, and every shape
inheriting `currentColor`.

Then look at the rendered mark at 16, 20, 24, 32, 64 and 512px. **Expect**: each distinct, none
smudged, the stone count stepping down rather than the stones merely shrinking.

**Failure**: stones merging at 16px, or a four-stone mark below 32px.

---

## V3 — The shell stops flashing dark

Open the app with the network throttled, or install it and launch from the home screen.

**Expect**: browser chrome tinted terracotta; the installed app's splash cream. No dark frame at
any point.

**Failure**: any near-black — `#12141a` survived somewhere.

---

## V4 — The installed icon is not clipped

Install to an Android home screen, or inspect `icon-maskable-512.png` against an 80% safe circle.

**Expect**: the whole mark inside the circle; no stone touching or crossing it.

**Failure**: a clipped stone means the maskable variant was replaced with the standard one.

---

## V5 — An existing second factor still verifies

The scenario FR-004 exists for, end to end:

1. Before deploying the rename, enrol a second factor and keep the authenticator entry.
2. Deploy the rename.
3. Sign in and complete the second factor with the **same** entry.

**Expect**: verification succeeds. The entry still reads "Password Manager" in the authenticator
app — that is correct, not a defect. Only new enrolments say Cairn.

**Failure**: verification rejects a valid code. That is a data-loss-grade regression; revert.

---

## V6 — A returning visitor gets the rebrand without losing anything

The app updates by prompt, not silently (`registerType: 'prompt'`).

1. Load the app **before** deploying, so a copy is cached. Store a secret.
2. Deploy.
3. Reload.

**Expect**: the update prompt appears; accepting it reloads into Cairn with the new icons. The
stored secret is intact and no sign-in is required. Before accepting, the old name and icons are
still shown — that is the existing update path working, not a fault.

Then, with the network off, reload once more. **Expect**: the app still opens and the vault is
still readable — the icon swap did not disturb the precache.

**Failure**: data lost, a forced sign-in, or an offline load that fails after the icon change.

---

## V7 — The whole suite, unchanged but for the name

```sh
pnpm -r typecheck
pnpm lint
pnpm -r build
pnpm -r test
pnpm --filter frontend exec playwright test
```

**Expect**: green. Exactly one pre-existing assertion changed —
`frontend/tests/unit/vault-rail.test.tsx:186` — plus the two new test files. No behavioural
assertion removed or weakened anywhere (SC-005).

**Failure**: any other test needing an edit to pass means the change reached further than a name.

---

## Not verified here

- **Mail naming.** The mailer cannot reach a real provider — no TLS, no authentication — so the
  `From` line is verified by reading what would be sent, not by receiving it.
- **Trademark clearance (FR-001).** Not a runnable check. It gates publication, not this work, and
  the deploy to the existing unlisted address proceeds without it (FR-001a).
