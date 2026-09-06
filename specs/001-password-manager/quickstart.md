# Quickstart: Run and Validate the Password Manager

**Date**: 2026-08-26 | **Plan**: [plan.md](./plan.md)

This is a validation guide, not an implementation guide. Each scenario proves a specific slice works
end to end. Implementation detail lives in `tasks.md` and the code.

## Prerequisites

- Node.js 22 LTS, pnpm 9
- Docker (PostgreSQL 17 and Testcontainers)
- A modern browser; Playwright installs its own for E2E

## Setup

```bash
pnpm install
docker compose up -d db            # PostgreSQL on :5432
cp .env.example .env               # dev secrets only; never commit a real .env
pnpm --filter backend db:migrate   # apply migrations
pnpm --filter backend db:seed      # seed the four built-in templates (FR-029)
```

## Run

```bash
pnpm dev                # backend on :3000, frontend on :5173
pnpm --filter backend dev
pnpm --filter frontend dev
```

## Test

```bash
pnpm test                       # everything
pnpm test:security              # Principle IV surface — must be green before any merge
pnpm --filter frontend test:crypto   # known-answer vectors (research.md §10)
pnpm test:e2e                   # Playwright, includes offline and revocation scenarios
```

`pnpm test:security` is the gate. Per the constitution's Development Workflow section, a change to any
security-critical path MUST NOT merge on a red or skipped run.

---

## Validation scenarios

Each maps to a user story and its acceptance scenarios in [spec.md](./spec.md).

### V1 — Zero-knowledge storage (US1, FR-013/014, SC-004)

The scenario that proves the product's central claim.

1. Register at `/register`; confirm registration is **refused** until the no-recovery warning is
   acknowledged (FR-010).
2. Create a secret with value `correct-horse-battery-staple`.
3. Query the database directly:

   ```bash
   docker compose exec db psql -U pm -d pm -c \
     "SELECT title, field_values FROM secrets LIMIT 5;"
   ```

**Expected**: `title` and `field_values` are unreadable bytes. Grepping the whole database for the
plaintext returns nothing:

```bash
docker compose exec db pg_dump -U pm pm | grep -c 'correct-horse-battery-staple'   # must print 0
```

4. Capture the login request in DevTools → Network. **Expected**: the body carries `authHash` and no
   value equal to the master password or the StretchedMasterKey. This is the single most important
   assertion in the suite — see the warning in [contracts/crypto-envelope.md](./contracts/crypto-envelope.md).

### V2 — Auto-lock and key disposal (US1, FR-007/016)

1. Unlock, then idle past the configured auto-lock (set it to 1 minute in settings to test).
2. **Expected**: the vault locks, secrets are unreadable, and the master password is required again.
3. In the DevTools console, confirm no key material is reachable:

   ```js
   Object.keys(localStorage).length === 0
   ```

   **Expected**: `true`. Also confirm IndexedDB holds only ciphertext (Application → IndexedDB).

### V3 — Typed secrets and masking (US2, FR-029/034)

Create one secret of each built-in type. **Expected**: each renders its own field set; card number
and CVV are masked until explicitly revealed; saving with a required field empty is refused with the
field named.

### V4 — Search at scale (US3, SC-003)

```bash
pnpm --filter backend seed:bulk --secrets 5000
```

Unlock and search. **Expected**: results in under 1 second; the Network tab shows **no request** on
keystroke — search is client-side (research.md §4).

### V5 — Sharing, roles, and revocation (US4, FR-024/026/033, SC-005, SC-012)

Two accounts, A and B.

1. A creates "Family", invites B as **Viewer**. B accepts and reads a secret.
2. As B, attempt a write **directly against the API**, bypassing the UI:

   ```bash
   curl -X POST https://localhost:3000/api/v1/vaults/$VAULT/secrets \
     -H 'Content-Type: application/json' -b "pm_session=$B_SESSION" \
     -d '{"title":"...","templateVersionId":"...","fieldValues":{}}'
   ```

   **Expected**: `403 ROLE_INSUFFICIENT`. Testing through the UI alone would not prove this — the
   point is that the server enforces it independently of what the interface offers.
3. A promotes B to Editor; the write now succeeds.
4. A revokes B. **Expected**: B's reads return `404` within 60 seconds (SC-005) — verify this
   **before** any re-encryption has run, because FR-080 requires refusal to be independent of it.
   Confirm every one of B's `vault_key_wrap` rows is gone, at all generations, not just the current
   one. The activity log shows `invited`, `accepted`, `role_changed`, `revoked`, `rotation_started`;
   attempting to `UPDATE` the log as the app role fails — it is append-only at the database level.
5. Request a non-member vault as B. **Expected**: `404`, identical to a vault that does not exist
   (FR-027).

### V6 — Concurrent edit conflict (spec edge case)

Two members open the same secret; both save. **Expected**: the second save returns `409
REVISION_CONFLICT` with the current row, and the UI offers a merge. Neither edit is silently lost.

### V7 — TOTP (US5, FR-010)

Enrol an authenticator; sign out; sign in. **Expected**: a valid current code is required; an
incorrect code, a code from a previous step, and a **replayed** code from the current step are all
rejected. Each backup code works exactly once.

### V8 — Custom templates (US6, FR-032/033)

1. Define a custom template with one sensitive and one non-sensitive field; create a secret from it.
   **Expected**: the sensitive field is masked and encrypted exactly like a built-in one.
2. Add a field to a template that existing secrets already use. **Expected**: those secrets remain
   readable and show the new field empty — **and no database migration ran** (Principle V). Confirm:

   ```bash
   pnpm --filter backend db:migrate:status   # unchanged from before the template edit
   ```

### V9 — Offline read (US7, FR-054/057, SC-011/013)

1. Unlock online at least once, then set DevTools → Network → **Offline**.
2. Reload. **Expected**: the app shell loads, unlock with the master password succeeds, and secrets
   are readable.
3. Attempt to create or edit. **Expected**: refused, with an explanation that it requires connectivity.
4. Inspect IndexedDB. **Expected**: ciphertext only — no plaintext values, and no key material.

### V10 — Encrypted backup (FR-060–065, SC-014/015)

1. Export the vault; `grep` the downloaded file for a known secret value. **Expected**: zero matches.
2. Restore into a clean account. **Expected**: secrets, folders, tags, and templates all present.
3. Attempt export as a Viewer. **Expected**: `403`; and a successful export appears in the activity
   log.

### V11 — Account security visibility (research.md §9)

1. Sign in from a second browser profile. **Expected**: a new-device notification email (check
   MailHog at `http://localhost:8025` in dev).
2. Change the master password. **Expected**: the **current** master password is required — a valid
   session alone is refused — all other sessions are revoked, and every secret is still readable
   afterwards (FR-005).

---

### V12 — Resumable key rotation (FR-081–084, research.md §11)

Continues from V5, with A's vault holding 5,000 secrets and a third member C still active.

1. After A revokes B, a rotation opens. Kill A's browser tab **mid-rotation**, before it completes.
2. As C, list and open secrets. **Expected**: every secret opens — those already rewritten under
   generation `v+1` and those still at `v`. This is the FR-083 invariant: an interrupted rotation
   must never leave part of the vault unreadable.

   ```bash
   # Both generations must be live for remaining members while the job is open
   docker compose exec db psql -U pm pm -c \
     "SELECT key_version, count(*) FROM vault_key_wrap w
        JOIN vault_membership m ON m.id = w.membership_id
       WHERE m.vault_id = '$VAULT' AND m.status = 'active' GROUP BY 1;"
   # expect two rows while rotating, one row after close
   ```

3. As C, write a secret while the rotation is still open. **Expected**: it succeeds and is stored at
   the highest generation, so the job does not chase it.
4. Reopen A's tab. **Expected**: the rotation resumes from `cursor` rather than restarting; `doneCount`
   continues upward rather than resetting to zero.
5. Before letting it finish, confirm the vault has at least one folder and one tag. Let the secrets
   finish but hold back the folder batch. **Expected**: `rotation/close` returns `409` — this is the
   check that prevents permanent loss of folder, tag, and vault names.
6. Complete the remaining batches. **Expected**: close now succeeds; the old `vault_key_wrap` rows
   are gone and the vault shows no pending indicator (FR-084). Reload as another member and confirm
   every folder name, tag name, and the vault name still render (FR-081).
7. Attempt to open a second rotation while one is running. **Expected**: `409 ROTATION_IN_PROGRESS`.

### V13 — Invitation to someone with no account (FR-066–071, research.md §12)

1. As A, invite `nobody@example.test`, an address with no account. **Expected**: `202` with a pending
   invitation.
2. Inspect the stored row and the outbound email. **Expected — this is the decisive check for
   FR-067**: neither contains any key material, and the email names no vault:

   ```bash
   docker compose exec db psql -U pm pm -c "\d vault_invitation"   # no wrapped-key column exists
   docker compose exec db psql -U pm pm -c \
     "SELECT * FROM vault_invitation WHERE invitee_email = 'nobody@example.test';"
   # then read the captured message in the local mail catcher: it must not contain the vault name
   ```

3. Register that address as user D. **Expected**: the invitation moves to `ready` and A is notified.
4. As D, call `GET /invitations`. **Expected**: D sees that an invitation exists and who sent it, and
   **no vault name, size, or member list** (FR-066).
5. As D, attempt to read the vault before A completes the invitation. **Expected**: `404`.
6. As A, complete the invitation. As D, accept. **Expected**: D can now read the vault's secrets with
   D's own master password.
7. Issue a fresh invitation and withdraw it before completion. **Expected**: it cannot then be
   completed, and issue plus withdrawal both appear in the activity log (FR-070).

### V14 — Session re-authentication after a password change (FR-072–075)

1. Sign in as A on two browsers, 1 and 2. Unlock the vault on both.
2. On browser 1, change the master password.
3. On browser 2, **without touching the UI**, replay the existing session cookie directly against a
   data route — this is the check that matters, because a client-side prompt proves nothing:

   ```bash
   curl -i https://localhost:3000/api/v1/vaults/$VAULT/secrets -b "pm_session=$B2_SESSION"
   ```

   **Expected**: `401 REAUTH_REQUIRED`. The session is still listed as established, and no secret
   data is returned. A response of `200` here means the requirement was implemented client-side only
   and FR-073 is violated.
4. Call `POST /auth/reauth` on browser 2 with the AuthHash of the **new** password. **Expected**:
   `200` with the rewrapped keyring, no TOTP challenge (FR-074), and data routes work again.
5. Call `/auth/reauth` with the **old** password's AuthHash. **Expected**: `401 AUTH_FAILED`.

### V15 — Permanent deletion (FR-053, FR-076–079)

1. Create a secret, note its id, then delete it and confirm.
2. **Expected**: the row is gone, not flagged.

   ```bash
   docker compose exec db psql -U pm pm -c "SELECT count(*) FROM secret WHERE id = '$SECRET';"
   # must print 0 — and there must be no deleted_at column to check
   docker compose exec db psql -U pm pm -c "\d secret" | grep -c deleted_at   # must print 0
   ```

3. Confirm the activity log holds a `secret_deleted` entry carrying the id and **no title
   ciphertext or field values** (FR-079).
4. In a shared vault, have an Editor delete a secret. **Expected**: it disappears for the Owner too,
   with no restore offered anywhere in the UI (FR-078).

## Definition of done for the feature

- All eleven scenarios pass
- `pnpm test:security` green, written test-first per Principle IV
- No plaintext secret in the database, in any request body, in IndexedDB, in an export, or in logs
- The Constitution Check table in [plan.md](./plan.md) still reads PASS on every row
