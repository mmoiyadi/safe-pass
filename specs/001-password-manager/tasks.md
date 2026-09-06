---
description: "Task list for the Password Manager feature"
---

# Tasks: Password Manager

**Input**: Design documents from `/specs/001-password-manager/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Test tasks are **mandatory** for authentication, key derivation, encryption/decryption,
authorization, sharing and revocation, session lifecycle, and 2FA — Constitution Principle IV
requires failing tests written and reviewed *before* implementation on those paths, with negative
cases explicit. Presentational code has no required test tasks.

**Organization**: Tasks are grouped by user story so each story is independently implementable and
testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: Which user story the task serves (US1–US7)
- Every task names its exact file path

## Path Conventions

Web application layout from plan.md: `backend/src/`, `frontend/src/`, `shared/src/`.
**All cryptography lives in `frontend/src/crypto/`.** No file under `backend/` may import it.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository, toolchain, and the type boundary that makes a Principle I violation a
compile error.

- [X] T001 Create the three-package workspace (`backend/`, `frontend/`, `shared/`) with root `package.json`, `pnpm-workspace.yaml`, and `tsconfig.base.json` in strict mode
- [X] T002 [P] Initialize `backend/` with Fastify 5, Prisma 6, Node 22 types, and `backend/tsconfig.json`
- [X] T003 [P] Initialize `frontend/` with React 19, Vite 6, `vite-plugin-pwa`, and `frontend/tsconfig.json`
- [X] T004 [P] Initialize `shared/` with `shared/package.json` and `shared/tsconfig.json`, exporting types only and declaring no runtime dependencies
- [X] T005 [P] Configure ESLint and Prettier at the repo root with a rule banning imports of `frontend/src/crypto` from `backend/**` in `eslint.config.js`
- [X] T006 [P] Add `docker-compose.yml` at the repo root with PostgreSQL 17 and a local mail catcher for notification tests
- [X] T007 [P] Configure Vitest with Testcontainers in `backend/vitest.config.ts` and `frontend/vitest.config.ts`
- [X] T008 [P] Configure Playwright in `frontend/playwright.config.ts` with offline and multi-context (two-account) projects
- [X] T009 Pin all cryptographic dependencies to exact versions in `backend/package.json` and `frontend/package.json` per the constitution's pinned-crypto-deps standard

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The envelope type, database schema, and server guards every story depends on.

**⚠️ CRITICAL**: No user story work may begin until this phase completes.

- [X] T010 Define the branded `Envelope<T>` type and base64url codec in `shared/src/envelope.ts` exactly per [contracts/crypto-envelope.md](./contracts/crypto-envelope.md)
- [X] T011 [P] Define shared API request/response types in `shared/src/api.ts` for every path in [contracts/openapi.yaml](./contracts/openapi.yaml)
- [X] T012 [P] Define the error-code union and HTTP status mapping in `shared/src/errors.ts` per the error model in [contracts/README.md](./contracts/README.md)
- [X] T013 Write the Prisma schema in `backend/src/db/schema.prisma` covering every entity in [data-model.md](./data-model.md): User, UserKeyring, Vault, VaultMembership, VaultKeyWrap, VaultInvitation, VaultRotation, Secret, Template, TemplateVersion, Folder, Tag, SecretTag, Session, SignInEvent, TotpEnrolment, BackupCode, ActivityLogEntry
- [X] T014 Add the check constraints and partial unique indexes from data-model.md to `backend/src/db/migrations/` — `autoLockMinutes <= 15`, one personal vault per owner, one running rotation per vault, one live invitation per (vault, email)
- [X] T015 Add a migration in `backend/src/db/migrations/` creating a non-owner `pm_app` role, running `REVOKE UPDATE, DELETE ON activity_log_entry` for it, and installing a BEFORE UPDATE OR DELETE trigger, so the log is append-only at the database level and not by convention. The role must be non-owner: a REVOKE against a table's owner is a no-op in PostgreSQL
- [X] T016 [P] Implement the Fastify error serializer in `backend/src/middleware/errors.ts`, emitting the `{ error: { code, message, details } }` shape and never including secret values
- [X] T017 [P] Implement log redaction in `backend/src/middleware/logging.ts` so master passwords, AuthHashes, envelopes, and TOTP seeds can never reach any log sink (FR-020)
- [X] T018 [P] Implement rate limiting in `backend/src/middleware/rate-limit.ts` for login, unlock, TOTP, invitation, and public-key lookup routes (FR-004)
- [X] T019 Implement the Fastify server bootstrap, route registration, and HTTPS-only enforcement in `backend/src/server.ts`
- [X] T020 [P] Scaffold the React app shell, router, and theme in `frontend/src/main.tsx` and `frontend/src/App.tsx`
- [X] T021 [P] Seed the four built-in templates (Website Account, Credit Card, Identity/PAN Card, Secure Note) in `backend/src/db/seed.ts` as data rows, not code (FR-036, Principle V)

**Checkpoint**: schema migrates, server boots, `shared/` types compile against both packages.

---

## Phase 3: User Story 1 — Secure Vault Access and Secret Storage (P1) 🎯 MVP

**Goal**: A user registers, acknowledges that there is no recovery, unlocks a personal vault, saves
an encrypted secret, and reads it back after signing out — with the server never able to read it.

**Independent test**: Register an account, save a secret, sign out, sign back in, read it. Then dump
the database and confirm the value does not appear in plaintext.

### Tests for US1 (Principle IV — write these first, and confirm they fail)

- [X] T022 [P] [US1] Argon2id known-answer tests against RFC 9106 vectors in `frontend/tests/crypto/kdf.test.ts`
- [X] T023 [P] [US1] HKDF-SHA256 known-answer tests against RFC 5869 vectors in `frontend/tests/crypto/hkdf.test.ts`
- [X] T024 [P] [US1] AES-256-GCM known-answer tests against NIST CAVP vectors in `frontend/tests/crypto/aead.test.ts`
- [X] T025 [P] [US1] Envelope round-trip plus negative cases in `frontend/tests/crypto/envelope.test.ts` — a single-bit ciphertext flip MUST fail to decrypt and MUST NOT fall back to a best-effort result (FR-018)
- [X] T026 [P] [US1] Key-hierarchy tests in `frontend/tests/crypto/keyring.test.ts` asserting that `AuthHash` and `StretchedMasterKey` are different values and that neither is derivable from the other
- [X] T027 [P] [US1] Request-payload inspection test in `frontend/tests/crypto/no-leak.test.ts` asserting the exact bytes leaving the client at login contain no master password and no `StretchedMasterKey` — the single most likely implementation mistake
- [X] T028 [P] [US1] Session lifecycle tests in `backend/tests/security/session.test.ts` — expired token, revoked token, cross-user token reuse, all refused
- [X] T029 [P] [US1] Registration and login tests in `backend/tests/security/auth.test.ts` — wrong password, unknown account, and the assertion that both return an identical `401 AUTH_FAILED` body and timing (FR-003)
- [X] T030 [P] [US1] Master-password-change tests in `backend/tests/security/reauth.test.ts` — a sibling session replaying its cookie against a data route MUST get `401 REAUTH_REQUIRED`, proving enforcement is server-side and not a client prompt (FR-073)

### Implementation for US1

- [X] T031 [P] [US1] Implement Argon2id and PBKDF2-fallback derivation in `frontend/src/crypto/kdf.ts`, with parameters from research.md §2 and email as normalized salt
- [X] T032 [P] [US1] Implement master password strength estimation in `frontend/src/crypto/password-strength.ts` using `@zxcvbn-ts/core`, refusing under 12 characters or a score below 3, lazy-loaded so the dictionary stays out of the main bundle (FR-002)
- [X] T033 [P] [US1] Implement the live strength meter component in `frontend/src/components/StrengthMeter.tsx`, wired into both the registration form and the change-password form (FR-002)
- [X] T034 [P] [US1] Implement `encrypt`/`decrypt` over the envelope format in `frontend/src/crypto/envelope.ts`, using a fresh `crypto.getRandomValues(12)` nonce per call
- [X] T035 [US1] Implement `MasterKey`, `StretchedMasterKey`, and `AuthHash` derivation in `frontend/src/crypto/master-key.ts` — HKDF expands to 32 bytes; there is no `macKey`
- [X] T036 [US1] Implement UserKey generation, RSA-4096 keypair generation, and wrap/unwrap in `frontend/src/crypto/user-key.ts`
- [X] T037 [US1] Implement VaultKey generation and wrap/unwrap in `frontend/src/crypto/vault-key.ts`, selecting the key by the row's `keyVersion` rather than the vault's current version
- [X] T038 [US1] Implement the in-memory keyring in `frontend/src/vault/keyring.ts` — non-extractable `CryptoKey` where the algorithm allows, never written to `localStorage`, `sessionStorage`, IndexedDB, or a cookie (FR-019)
- [X] T039 [US1] Implement session and Argon2id-digest handling in `backend/src/modules/auth/session.ts`, storing only the SHA-256 digest of the opaque token
- [X] T040 [US1] Implement `GET /auth/kdf-params` in `backend/src/modules/auth/kdf-params.route.ts`, returning parameters for **any** email so the endpoint cannot enumerate accounts
- [X] T041 [US1] Implement `POST /auth/register` in `backend/src/modules/auth/register.route.ts`, refusing the request unless `recoveryAcknowledged` is true (FR-010)
- [X] T042 [US1] Implement `POST /auth/login` in `backend/src/modules/auth/login.route.ts` with constant-time-floor responses for failures
- [X] T043 [US1] Implement the session guard in `backend/src/middleware/session.ts`, rejecting requests whose session carries `reauthRequiredAt` with `401 REAUTH_REQUIRED` for every route except `POST /auth/reauth` (FR-073)
- [X] T044 [US1] Implement `PUT /auth/master-password` in `backend/src/modules/auth/master-password.route.ts` — requires the **current** master password, rewraps only the UserKey, and stamps every sibling session as needing re-auth (FR-005, FR-072)
- [X] T045 [US1] Implement `POST /auth/reauth` in `backend/src/modules/auth/reauth.route.ts`, clearing the flag and returning the rewrapped keyring without re-challenging the second factor (FR-074)
- [X] T046 [US1] Implement `GET /auth/sessions` and `DELETE /auth/sessions` in `backend/src/modules/auth/sessions.route.ts` (FR-008)
- [X] T047 [P] [US1] Implement personal-vault creation on registration — implemented inside the `POST /auth/register` transaction in `backend/src/modules/auth/auth.routes.ts`, since it must be atomic with account creation, rather than in a separate `create-personal.ts` (FR-021)
- [X] T048 [P] [US1] Implement secret create and read routes in `backend/src/modules/secrets/secrets.route.ts`, treating every envelope as opaque bytes with no decryption path
- [X] T049 [US1] Implement the registration screen in `frontend/src/features/register/`, including the explicit no-recovery warning and acknowledgement checkbox (FR-010)
- [X] T050 [US1] Implement account deletion with a 30-day window in `backend/src/modules/auth/account.route.ts`, pseudonymizing rather than deleting activity rows in other owners' vaults (research.md §8, FR-011)
- [X] T051 [P] [US1] Implement the forgotten-master-password screen in `frontend/src/features/unlock/ForgotPassword.tsx`, stating plainly that recovery is impossible, explaining why the operator cannot help, and offering account deletion as the only available action (FR-011)
- [X] T052 [US1] Wire the forgotten-password screen to account deletion in `backend/src/modules/auth/account.route.ts`, requiring email-link confirmation because the user cannot prove knowledge of the master password (FR-011)
- [X] T053 [US1] Implement the unlock screen and derivation progress indicator in `frontend/src/features/unlock/`
- [X] T054 [US1] Implement auto-lock on inactivity in `frontend/src/vault/auto-lock.ts`, defaulting to 15 minutes and clearing the keyring on lock, sign-out, and tab teardown (FR-007, FR-019)
- [X] T055 [US1] Implement secret create and detail views in `frontend/src/features/secret-detail/`, encrypting field values before they enter any request body
- [X] T056 [US1] Implement the master-password-change flow in `frontend/src/features/settings/change-password.tsx`, warning that other devices will need the new password and that offline devices keep access until they reconnect (FR-075)
- [X] T057 [US1] Handle `401 REAUTH_REQUIRED` globally in `frontend/src/api/client.ts` by clearing the keyring and prompting for the new master password

**Checkpoint**: US1 is independently shippable. Quickstart V1, V2, and V14 pass.

---

## Phase 4: User Story 2 — Typed Secrets from Built-In Templates (P2)

**Goal**: Create one secret of each built-in type, with sensitive fields encrypted and masked.

**Independent test**: Create a website account, credit card, PAN card, and secure note; confirm
sensitive fields are masked in lists and detail views, and reveal-on-demand works.

- [X] T058 [P] [US2] Template and template-version read routes in `backend/src/modules/templates/templates.route.ts`
- [X] T059 [P] [US2] Full secret CRUD with optimistic concurrency in `backend/src/modules/secrets/secrets.route.ts` — a `revision` mismatch returns `409 REVISION_CONFLICT` with the current row attached
- [X] T060 [US2] Implement permanent deletion in `backend/src/modules/secrets/delete.ts` — a real `DELETE`, no soft-delete column, no restore path (FR-053, FR-076)
- [X] T061 [US2] Record `secret_deleted` in the activity log in `backend/src/modules/activity/record.ts` with actor, subject id, and time, and **no title ciphertext or field values** (FR-079)
- [X] T062 [P] [US2] Implement the template-driven form renderer in `frontend/src/features/templates/TemplateForm.tsx`, driving encryption from each field's `sensitive` flag rather than from the rendering code
- [X] T063 [P] [US2] Implement field masking and reveal-on-demand in `frontend/src/components/SensitiveField.tsx` (FR-041)
- [X] T064 [P] [US2] Implement clipboard copy with a 30-second clear and a visible notice that it will clear in `frontend/src/components/CopyButton.tsx` (FR-052)
- [X] T065 [US2] Implement the delete confirmation dialog in `frontend/src/features/secret-detail/DeleteDialog.tsx` — names the secret, states the deletion cannot be undone, says a prior backup is the only recovery, and warns that in a shared vault it is immediate for every member (FR-053, FR-077, FR-078)
- [X] T066 [US2] Implement the secret list view with per-type presentation in `frontend/src/features/vault-list/SecretList.tsx`

**Checkpoint**: Quickstart V3 and V15 pass.

---

## Phase 5: User Story 3 — Find and Organise Secrets (P3)

**Goal**: Search a large vault by title and non-sensitive metadata, and organise with folders and tags.

**Independent test**: Load 5,000 secrets, search by title, confirm results in under 1 second.

- [X] T067 [P] [US3] Folder CRUD in `backend/src/modules/secrets/folders.route.ts`, requiring an explicit `orphan` or `cascade` disposition on delete so contents cannot be destroyed silently (FR-048)
- [X] T068 [P] [US3] Tag CRUD and secret-tag association in `backend/src/modules/secrets/tags.route.ts`
- [X] T069 [US3] Implement the client-side search index in `frontend/src/search/index.ts`, built over decrypted metadata in memory because the server cannot read encrypted titles (research.md §4)
- [X] T070 [US3] Implement search UI with debounced query and result ranking in `frontend/src/features/search/`
- [X] T071 [P] [US3] Implement folder and tag management UI in `frontend/src/features/organise/`
- [X] T072 [P] [US3] Implement folder and tag filtering of the secret list in `frontend/src/features/vault-list/Filters.tsx` (FR-047)
- [X] T073 [US3] Add a search performance test with a 5,000-secret fixture in `frontend/tests/unit/search.perf.test.ts` asserting p95 under 1 second (SC-003)

**Checkpoint**: Quickstart V4 passes.

---

## Phase 6: User Story 4 — Multiple Vaults and Sharing (P4)

**Goal**: Create additional vaults, share them with roles, invite people who may not have an account
yet, and revoke access with a resumable re-encryption.

**Independent test**: Two accounts. Create a shared vault, invite the second user, verify role
enforcement at the API, revoke, and confirm refusal within 60 seconds.

### Tests for US4 (Principle IV — write these first, and confirm they fail)

- [ ] T074 [P] [US4] Authorization matrix tests in `backend/tests/security/authorization.test.ts` exercising every vault route as Owner, Editor, Viewer, revoked member, and non-member
- [ ] T075 [P] [US4] Non-enumeration tests in `backend/tests/security/enumeration.test.ts` — a non-member's request for a vault returns `404` identical to a vault that does not exist, and `/users/public-key` returns `404` identically for unknown and unverified accounts
- [ ] T076 [P] [US4] Revocation tests in `backend/tests/security/revocation.test.ts` asserting refusal is immediate and **independent of re-encryption**, and that every `VaultKeyWrap` for the revoked member is deleted at all generations (FR-080)
- [ ] T077 [P] [US4] Rotation-integrity tests in `backend/tests/security/rotation.test.ts` — remaining members can read both generations mid-rotation, an interrupted rotation resumes from its cursor, and close is refused while any row remains at the old generation (FR-083)
- [ ] T078 [P] [US4] Pending-invitation tests in `backend/tests/security/invitation.test.ts` asserting the row and the outbound email carry no key material and no vault name (FR-066, FR-067)

### Implementation for US4

- [ ] T079 [P] [US4] Vault CRUD in `backend/src/modules/vaults/vaults.route.ts`, refusing deletion of a vault that still has other members (FR-024)
- [ ] T080 [US4] Implement the vault authorization middleware in `backend/src/middleware/vault-authz.ts`, resolving `VaultMembership(vaultId, callerId, status='active')` **before** loading any data, then checking role
- [ ] T081 [P] [US4] Implement `GET /users/public-key` in `backend/src/modules/vaults/public-key.route.ts`, rate limited and returning a uniform `404` for unknown and unverified accounts
- [ ] T082 [US4] Implement `POST /vaults/{id}/members` in `backend/src/modules/vaults/invite.route.ts` with both outcomes: `201` with a wrapped key when the address has an account, `202` with a pending invitation when it does not (FR-025, FR-066)
- [ ] T083 [US4] Implement pending-invitation storage in `backend/src/modules/vaults/invitation.service.ts` and **reject any request that supplies key material for a pending invitation** (FR-067)
- [ ] T084 [US4] Promote pending invitations to `ready` on registration and notify vault owners, in `backend/src/modules/auth/register.route.ts` and `backend/src/modules/vaults/invitation.service.ts` (FR-069)
- [ ] T085 [US4] Implement `POST /vaults/{id}/invitations/{invId}/complete` in `backend/src/modules/vaults/invitation.route.ts`, creating the membership from the Owner-supplied wrap
- [ ] T086 [P] [US4] Implement `GET /vaults/{id}/invitations`, `DELETE .../{invId}`, and `GET /invitations` in `backend/src/modules/vaults/invitation.route.ts`, disclosing no vault name to the recipient (FR-066, FR-070)
- [ ] T087 [P] [US4] Implement invitation expiry at 14 days as a scheduled job in `backend/src/modules/vaults/invitation.expiry.ts` (FR-071)
- [ ] T088 [US4] Implement membership accept, decline, role change, and revoke in `backend/src/modules/vaults/members.route.ts`, refusing removal of the last owner (FR-035)
- [ ] T089 [US4] Implement revocation in `backend/src/modules/vaults/revoke.ts` — delete every `VaultKeyWrap` for that membership at all generations and open a rotation, in one transaction (FR-080)
- [ ] T090 [US4] Implement `POST /vaults/{id}/rotation` in `backend/src/modules/vaults/rotation.route.ts`, registering generation v+1 alongside v without re-encrypting anything
- [ ] T091 [US4] Implement `POST /vaults/{id}/rotation/batch` in `backend/src/modules/vaults/rotation.route.ts` as a single transaction per batch that advances the cursor, accepting re-encrypted secrets, folder names, tag names, and the vault name (FR-081, FR-083)
- [ ] T092 [US4] Implement `POST /vaults/{id}/rotation/close` in `backend/src/modules/vaults/rotation.route.ts`, refusing while any secret, folder, tag, or vault name remains at `fromVersion`, and deleting the old generation's wraps only on success
- [ ] T093 [US4] Add a rotation-completeness test in `backend/tests/security/rotation-completeness.test.ts` asserting close is refused when a folder, tag, or vault name is still at the old generation — the check that prevents permanent loss of those labels (FR-081)
- [ ] T094 [US4] Implement `GET /vaults/{id}/rotation` in `backend/src/modules/vaults/rotation.route.ts` for progress and resume
- [ ] T095 [US4] Implement the append-only activity log writer in `backend/src/modules/activity/activity.route.ts` covering every invitation, membership, role, rotation, and export action
- [ ] T096 [US4] Implement multi-generation key selection in `frontend/src/vault/keyring.ts` so a reader picks the key by each row's `keyVersion` and a writer always uses the highest generation it holds
- [ ] T097 [US4] Implement the client-side rotation worker in `frontend/src/vault/rotation-worker.ts` — batched re-encryption of secrets, folder names, tag names, and the vault name, resuming from the server's cursor and never blocking reads or writes (FR-081, FR-082, FR-083)
- [ ] T098 [P] [US4] Implement the vault switcher and vault creation UI in `frontend/src/features/vault-list/`
- [ ] T099 [P] [US4] Implement sharing UI in `frontend/src/features/sharing/` — invite by email, role assignment, member list, revoke
- [ ] T100 [US4] Implement pending-invitation UI in `frontend/src/features/sharing/PendingInvitations.tsx`, telling the inviting owner that completion needs their action later and is not immediate (FR-068)
- [ ] T101 [US4] Implement the rotation progress indicator and persistent incomplete-rotation banner in `frontend/src/features/sharing/RotationStatus.tsx`, stating that the removed member's old key still opens data they already hold until it completes (FR-084, FR-085)
- [ ] T102 [P] [US4] Implement the activity log view in `frontend/src/features/sharing/ActivityLog.tsx`

**Checkpoint**: Quickstart V5, V12, and V13 pass.

---

## Phase 7: User Story 5 — Two-Factor Authentication (P5)

**Goal**: Enrol an authenticator app, require a code at sign-in, and issue single-use backup codes.

**Independent test**: Enrol an authenticator, sign out, and confirm sign-in requires a valid code.

### Tests for US5 (Principle IV — write these first, and confirm they fail)

- [ ] T103 [P] [US5] TOTP tests against RFC 6238 vectors in `frontend/tests/crypto/totp.test.ts`, including replay-within-step rejection and ±1-step drift acceptance
- [ ] T104 [P] [US5] Backup-code tests in `backend/tests/security/backup-codes.test.ts` asserting each code is accepted exactly once

### Implementation for US5

- [ ] T105 [P] [US5] Implement TOTP generation and verification in `frontend/src/crypto/totp.ts`, unwrapping the seed under the UserKey
- [ ] T106 [US5] Implement `POST /auth/totp/enrol`, `/challenge`, and `/verify` in `backend/src/modules/auth/totp.route.ts` with the pending-session upgrade flow from [contracts/README.md](./contracts/README.md)
- [ ] T107 [US5] Implement `DELETE /auth/totp` in `backend/src/modules/auth/totp.route.ts`, requiring a fresh master password proof rather than merely a valid session, and sending the removal notification (FR-015)
- [ ] T108 [P] [US5] Implement second-factor removal and re-enrolment UI in `frontend/src/features/settings/totp/RemoveTotp.tsx`, warning that removal lowers account protection (FR-015)
- [ ] T109 [P] [US5] Implement backup-code issue and single-use redemption in `backend/src/modules/auth/backup-codes.ts` (FR-014)
- [ ] T110 [P] [US5] Implement sign-in event recording with 90-day retention in `backend/src/modules/activity/sign-in-events.ts` (research.md §9)
- [ ] T111 [P] [US5] Implement `GET /security/sign-ins` in `backend/src/modules/activity/security.route.ts`
- [ ] T112 [US5] Implement security notification emails in `backend/src/modules/activity/notifications.ts` for new-device sign-in, master password change, 2FA removal, backup-code use, and vault export (research.md §9)
- [ ] T113 [P] [US5] Implement TOTP enrolment UI with QR code and backup-code display in `frontend/src/features/settings/totp/`
- [ ] T114 [P] [US5] Implement the sign-in second-factor step in `frontend/src/features/unlock/TotpStep.tsx`
- [ ] T115 [P] [US5] Implement the sign-in history view in `frontend/src/features/settings/SignInHistory.tsx`

**Checkpoint**: Quickstart V7 and V11 pass.

---

## Phase 8: User Story 6 — Custom Templates and Custom Fields (P6)

**Goal**: Define new templates and custom fields without a schema migration.

**Independent test**: Define a template with a mix of sensitive and non-sensitive fields, save a
secret under it, and confirm no migration ran.

- [ ] T116 [P] [US6] Implement template create and update in `backend/src/modules/templates/templates.route.ts`, refusing duplicate field names within a version (FR-043)
- [ ] T117 [US6] Implement template versioning in `backend/src/modules/templates/versions.ts` so editing a template creates a new version and existing secrets stay readable under the old one (FR-040)
- [ ] T118 [P] [US6] Implement the template editor UI in `frontend/src/features/templates/TemplateEditor.tsx`
- [ ] T119 [US6] Implement the data-loss warning before a template change that would orphan existing field values in `frontend/src/features/templates/ChangeWarning.tsx` (FR-042)
- [ ] T120 [P] [US6] Implement per-secret custom fields in `frontend/src/features/secret-detail/CustomFields.tsx` (FR-039)
- [ ] T121 [US6] Add a test in `backend/tests/integration/no-migration.test.ts` asserting `prisma migrate status` is unchanged after creating a custom template and saving a secret under it (Principle V, quickstart V8)

**Checkpoint**: Quickstart V8 passes.

---

## Phase 9: User Story 7 — Install and Use on Mobile (P7)

**Goal**: Install as a PWA, read vaults offline from an encrypted cache, and export/restore an
encrypted backup.

**Independent test**: Install on a mobile device, open a vault, disable the network, and confirm
secrets are still readable after entering the master password.

### Tests for US7 (Principle IV — write these first, and confirm they fail)

- [ ] T122 [P] [US7] Offline-cache tests in `frontend/tests/crypto/offline-cache.test.ts` asserting the IndexedDB cache holds only ciphertext and no key material (FR-055, SC-013)
- [ ] T123 [P] [US7] Backup tests in `backend/tests/security/export.test.ts` asserting the export contains no master password and nothing that permits decryption without it (FR-062, SC-015)

### Implementation for US7

- [ ] T124 [P] [US7] Implement the service worker and app-shell caching in `frontend/src/sw/service-worker.ts` via Workbox
- [ ] T125 [P] [US7] Add the web app manifest and icons in `frontend/public/manifest.webmanifest` (FR-050)
- [ ] T126 [US7] Implement the encrypted IndexedDB vault cache in `frontend/src/vault/offline-cache.ts`, storing ciphertext only and requiring the master password on every session (FR-055, FR-056)
- [ ] T127 [US7] Implement 30-day staleness expiry and cache discard on revocation or disabled offline access in `frontend/src/vault/offline-cache.ts` (FR-058, FR-059)
- [ ] T128 [US7] Refuse creates, edits, deletes, and sharing while offline with a clear explanation in `frontend/src/api/client.ts` (FR-057)
- [ ] T129 [P] [US7] Implement `GET /vaults/{id}/export` restricted to Owners and recorded in the activity log in `backend/src/modules/backup/export.route.ts` (FR-065)
- [ ] T130 [P] [US7] Implement `POST /vaults/import` in `backend/src/modules/backup/import.route.ts`
- [ ] T131 [US7] Implement client-side backup assembly and restore in `frontend/src/features/settings/backup.tsx`, stating that the file opens only with the master password in force when it was taken (FR-064)
- [ ] T132 [P] [US7] Implement responsive layouts down to a 360-pixel viewport across all primary screens in `frontend/src/components/` (FR-051, SC-009)

**Checkpoint**: Quickstart V9 and V10 pass.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T133 [P] Implement `GET /account/personal-data` in `backend/src/modules/auth/account.route.ts` for the portability export (research.md §8)
- [ ] T134 [P] Add an export/restore fidelity test in `backend/tests/integration/backup-roundtrip.test.ts` exporting a 5,000-secret vault and restoring it into a clean account, asserting every secret, folder, tag, and template definition survives (SC-014)
- [ ] T135 [P] Add the Playwright end-to-end suite in `frontend/tests/e2e/` covering quickstart scenarios V1–V15
- [ ] T136 Add the zero-knowledge database assertion to CI in `backend/tests/security/no-plaintext.test.ts` — dump the database after a seeded run and assert the known secret value appears zero times (SC-004)
- [ ] T137 [P] Add the concurrent-edit conflict test in `backend/tests/integration/concurrency.test.ts` asserting the second save is refused rather than silently discarding the first (quickstart V6)
- [ ] T138 [P] Add load testing for 1,000 concurrent users in `backend/tests/integration/load.test.ts` (SC-010)
- [ ] T139 [P] Add the accessibility pass across primary screens in `frontend/tests/e2e/a11y.spec.ts`
- [ ] T140 [P] Write operator documentation in `docs/operations.md` covering deployment, TLS, backup of ciphertext, and the breach runbook (research.md §8)
- [ ] T141 [P] Write the security model summary in `docs/security-model.md` for users, stating plainly what the operator can and cannot see (data-model.md closing section)
- [ ] T142 [P] Add a dependency advisory scan to CI in `.github/workflows/audit.yml` and a release checklist gate in `docs/operations.md`, per the constitution's requirement that crypto, auth, and serialization dependencies be reviewed for known advisories before a release
- [ ] T143 Run a threat-model review of the crypto and auth surface and record its findings in `docs/threat-model.md` before release, per the constitution's Development Workflow gate

---

## Dependencies

**Phase order**: Setup (T001–T009) → Foundational (T010–T021) → user stories → Polish.

**User story dependencies**:

```text
US1 (P1) ─────────────────────────────────────▶ MVP, blocks everything
  ├─▶ US2 (P2)  needs secret CRUD + templates
  │     └─▶ US3 (P3)  needs secrets to search
  ├─▶ US4 (P4)  needs the key hierarchy and vaults
  ├─▶ US5 (P5)  needs sessions and the UserKey
  ├─▶ US6 (P6)  needs templates from US2
  └─▶ US7 (P7)  needs vaults and secrets to cache and export
```

US2, US4, and US5 are independent of each other once US1 is done and may proceed in parallel. US3
depends on US2. US6 depends on US2. US7 is best done last because it must cache whatever the earlier
stories produce.

**Critical within-story ordering**:

- T031 and T034 block T035 (master-key derivation), which blocks T036, then T037 — the hierarchy
  builds top down from the KDF and the envelope.
- T043 (session guard) blocks T044 and T045; the guard must exist before the flag it enforces is set.
- T050 (account deletion) blocks T053; the forgotten-password screen offers deletion as its only
  action, so the endpoint must exist or the screen is a dead end.
- T089 (revocation) blocks T090–T094; a rotation is opened by a revocation.
- T090 (open rotation) blocks T091, which blocks T092 — a rotation cannot close before it batches.
- T096 (multi-generation key selection) blocks T097; the worker needs the reader to handle two
  generations.
- T092 and T093 travel together: the close precondition and the test that it refuses an incomplete
  rotation are the pair that prevents permanent loss of folder, tag, and vault names.

## Parallel execution examples

**Phase 1 setup**: T002–T008 all run together after T001.

**US1 tests**: T022–T030 are nine independent files and run together — all must fail before any
implementation task in Phase 3 begins.

**US1 crypto primitives**: T031, T032, T033, and T034 run in parallel; T035 waits for T031 (Argon2id)
and T034 (the envelope).

**US4 tests**: T074–T078 run together across five files.

**US4 backend and frontend**: T079/T081/T086/T087 (backend) can run alongside T098/T099/T102
(frontend) once T080 lands.

**Polish**: T132, T133, T134, T135, T137, T138, T139, T140, T141, T142 are all independent.

## Implementation strategy

**MVP is Phase 3 (US1) alone.** It delivers the entire security foundation — key hierarchy, master
password strength enforcement, registration with the no-recovery acknowledgement, the
forgotten-password dead-end screen, unlock, one encrypted secret, auto-lock, and server-enforced
re-authentication. It is demonstrable, and the zero-knowledge claim is provable against it with
quickstart V1.

**Then ship in priority order.** US2 makes it useful for real data. US3 makes it usable at scale.
US4 is the largest single increment and the one carrying the most risk — the two-generation rotation
model is where a subtle mistake would strand data — so it should not be compressed.

**The tests in T022–T030 and T074–T078 are not optional.** Constitution Principle IV requires them
written and reviewed before the code they cover. Three assertions in particular catch the most
damaging errors this design can produce: T027 (the wrong derived key reaching the server), T030
(re-authentication implemented as a client-side prompt), and T093 (a rotation closing while folder,
tag, or vault names are still under the destroyed key).
