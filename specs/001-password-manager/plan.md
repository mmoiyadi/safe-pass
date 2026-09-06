# Implementation Plan: Password Manager

**Branch**: `001-password-manager` | **Date**: 2026-09-01 (revised) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-password-manager/spec.md`

## Summary

A zero-knowledge personal password manager: users store website logins, cards, identity documents,
notes, and arbitrary custom data in vaults that can be private or shared with other users. Every
secret value is encrypted on the user's device with a key derived from their master password, so the
server holds ciphertext it can never read.

The technical approach is a **layered key hierarchy** rather than direct password-to-data encryption.
The master password derives a Master Key (Argon2id), which unwraps a randomly generated **User Key**,
which unwraps a per-vault **Vault Key**, which encrypts secret payloads. That indirection is what
makes three otherwise-incompatible requirements work at once: changing the master password rewraps
one key instead of re-encrypting every secret (FR-005); sharing wraps a Vault Key to each member's
public key so members never learn each other's passwords (FR-023); and revocation rotates the Vault
Key without touching unrelated vaults (FR-024).

**This plan was revised on 2026-09-01** after a clarification pass added FR-066 to FR-085. Three of
those four answers changed the design rather than merely adding surface — see *Clarification deltas*
below.

Delivery is a TypeScript monorepo — a Fastify + PostgreSQL API that stores opaque ciphertext, and a
React PWA that owns all cryptography, caches an encrypted vault copy in IndexedDB for offline reads,
and performs search client-side because the server cannot read what it stores.

## Technical Context

**Language/Version**: TypeScript 5.6 (strict), Node.js 22 LTS

**Primary Dependencies**: Fastify 5 (API), Prisma 6 (data access + migrations), React 19 + Vite 6
(client), `vite-plugin-pwa` / Workbox (service worker), `hash-wasm` (Argon2id in the browser),
WebCrypto (AES-256-GCM, HKDF, RSA-OAEP), `@noble/hashes` + `otpauth` (TOTP), `idb` (IndexedDB),
`@zxcvbn-ts/core` (master password strength, FR-002 — lazy-loaded on the two screens that need it, so
its dictionary stays out of the main bundle)

**Storage**: PostgreSQL 17 — ciphertext columns are `BYTEA`; template definitions and field values are
`JSONB` so new secret types need no migration (Principle V)

**Testing**: Vitest (unit + integration, with Testcontainers for a real PostgreSQL), Playwright
(end-to-end and PWA/offline scenarios), plus RFC test vectors for Argon2id, HKDF, AES-GCM, and TOTP

**Target Platform**: Modern evergreen browsers (Chrome/Edge 120+, Firefox 120+, Safari 17+) on
desktop and mobile; installable PWA; Linux server for the API

**Project Type**: Web application — API backend, PWA frontend, shared contract package

**Performance Goals**: Search 5,000 secrets in <1s at p95 (SC-003); unlock-to-read in <15s including
Argon2id derivation (SC-002); 1,000 concurrent users with no degradation (SC-010); vault unlock
derivation budget ≤2s on a mid-range mobile device

**Constraints**: Server MUST NOT be able to decrypt anything (Principle I); decrypted keys live in
memory only, never in `localStorage`/IndexedDB/cookies; auto-lock ≤15 min; offline read-only;
360px minimum viewport; ciphertext-only export

**Scale/Scope**: 1,000 concurrent users, up to 5,000 secrets per vault, 7 user stories, 85 functional
requirements, ~18 API resource groups, ~22 screens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| # | Principle | Gate | Pre-Phase 0 | Post-Phase 1 |
|---|-----------|------|-------------|--------------|
| I | Zero-Knowledge Encryption | No plaintext secret, master password, or derived key crosses the network boundary; Argon2id + AEAD from vetted libraries only | PASS | PASS — see [contracts/crypto-envelope.md](./contracts/crypto-envelope.md); every API payload carrying secret data is a typed ciphertext envelope. Re-checked against the new flows: pending invitations hold no key material (FR-067), and the redundant `macKey` was removed so no unused key material remains |
| II | Least-Privilege Access and Explicit Sharing | Server-side authorization on every read/write; per-recipient key wrapping; append-only audit log; no cross-account enumeration | PASS | PASS — `VaultKeyWrap` holds per-member wrapped keys per generation; revocation deletes every generation at once; every secret route resolves membership before data; `activity_log` is insert-only; `/users/public-key` returns 404 uniformly so invitations cannot enumerate accounts |
| III | Incremental Delivery With Clarified Requirements | Work ships as independently testable slices; open questions resolved before implementation | PASS | PASS — seven phased slices mapped to US1–US7 below; both spec deferrals resolved in [research.md](./research.md) |
| IV | Test-First for Security-Critical Code | Failing tests written first for auth, KDF, crypto, authz, sharing, session, 2FA — negative cases explicit | PASS | PASS — `tests/security/` is the designated test-first surface; known-answer vectors specified in research.md |
| V | Schema-Driven Extensibility | Secret types are data, not code; no migration to add a template or field; templates versioned | PASS | PASS — `templates` + `template_versions` tables, `JSONB` field values; adding a type is a row |
| — | Security & Data Protection Standards | TLS, bounded sessions, in-memory keys, 15-min auto-lock, TOTP, log redaction, rate limiting, pinned crypto deps, clipboard clearing | PASS | PASS — all mapped in research.md §7 |
| — | Development Workflow & Quality Gates | Spec-driven flow, threat-model review for crypto/auth changes, forward migrations | PASS | PASS |

**Result: no violations.** Re-evaluated in full after the 2026-09-01 revision; the three design
reversals were each checked against Principles I and II specifically, since two of them move key
material between tables. Seven items are recorded in Complexity Tracking below as deliberate cost
accepted to satisfy a principle, not as deviations from it.

### Clarification deltas (2026-09-01)

The clarification session ran *after* the first planning pass, so these four answers were folded back
into Phase 0 and Phase 1. Three of them invalidated a Phase 1 decision rather than extending it,
which is recorded here rather than silently overwritten.

| Clarification | Design consequence |
|---------------|--------------------|
| Invitations may be addressed to a non-user, held pending (FR-066–071) | **New** `VaultInvitation` entity holding *no key material*, four API paths, and a `/users/public-key` lookup. Sharing becomes a two-phase flow; access is no longer immediate. research.md §12 |
| Password change flags other sessions rather than ending them (FR-072–075) | `Session.reauthRequiredAt`, `401 REAUTH_REQUIRED`, `POST /auth/reauth`. Written as a **server-side** guard: a client already holding the UserKey can ignore a client-side prompt. research.md §13 |
| Deletion is permanent, no trash (FR-053, FR-076–079) | **Reverses** the earlier 30-day soft-delete assumption. `Secret.deletedAt` removed along with the purge job; the activity log can no longer name a deleted secret, because its title ciphertext is destroyed with it. research.md §14 |
| Revocation re-encryption is a resumable background job (FR-080–085) | **Reverses** the all-or-nothing rotation transaction. A vault now holds two live key generations mid-rotation, so `wrappedVaultKey` moves off `VaultMembership` into a new `VaultKeyWrap` table, plus a `VaultRotation` job entity and three rotation endpoints. research.md §11 |

The last one is the largest. The original design made rotation one atomic transaction; FR-082 and
FR-083 together forbid that, because a vault that must stay fully readable *while* being re-encrypted
necessarily has rows under two keys at once. That is a data-model change, not a scheduling change.

### Resolved spec deferrals

The spec's Deferred Decisions section required planning to settle two questions before the affected
work is scheduled. Both are resolved in [research.md](./research.md) §8 and §9:

- **Regulatory obligations** → GDPR/DPDP-aligned handling (account deletion, personal-data export,
  breach process, stated retention) without pursuing certification. PCI DSS treated as out of scope,
  with the scoping argument written down.
- **Account security visibility** → sign-in history plus email notification on new-device sign-in,
  master password change, second-factor removal, and vault export. Driven by the no-recovery
  decision: an undetected takeover is permanent.

## Project Structure

### Documentation (this feature)

```text
specs/001-password-manager/
├── plan.md              # This file
├── research.md          # Phase 0 output — key hierarchy, KDF params, deferrals resolved
├── data-model.md        # Phase 1 output — entities, schema, state transitions
├── quickstart.md        # Phase 1 output — run and validate end-to-end
├── contracts/
│   ├── README.md            # Conventions, error model, auth
│   ├── openapi.yaml         # REST API contract
│   └── crypto-envelope.md   # Client-side crypto contract (the load-bearing one)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── modules/
│   │   ├── auth/            # registration, login, session, TOTP, backup codes
│   │   ├── vaults/          # vault CRUD, membership, invitations, roles
│   │   ├── secrets/         # secret CRUD (opaque ciphertext), folders, tags
│   │   ├── templates/       # template + template version CRUD
│   │   ├── backup/          # encrypted export / restore
│   │   └── activity/        # append-only activity log, sign-in history
│   ├── middleware/          # session guard, vault authorization, rate limiting
│   ├── db/                  # Prisma schema, migrations, seed
│   └── server.ts
└── tests/
    ├── security/            # test-first surface (Principle IV)
    ├── integration/
    └── unit/

frontend/
├── src/
│   ├── crypto/              # ALL cryptography lives here — kdf, envelope, keyring, vault keys
│   ├── vault/               # in-memory keyring, auto-lock, offline cache
│   ├── features/            # unlock, vault-list, secret-detail, templates, sharing, settings
│   ├── components/
│   ├── search/              # client-side index over decrypted metadata
│   └── sw/                  # service worker, offline strategy
└── tests/
    ├── crypto/              # known-answer vectors, round-trip, tamper detection
    ├── e2e/                 # Playwright, incl. offline and revocation scenarios
    └── unit/

shared/
└── src/                     # API request/response types, envelope types, error codes
```

**Structure Decision**: Web application layout with a third `shared/` package. The frontend/backend
split is forced by the architecture — cryptography must live on the client and cannot be shared with
a server that is not permitted to perform it. `shared/` holds only TypeScript types for API payloads
and ciphertext envelopes, giving compile-time proof that the client and server agree on which fields
are opaque ciphertext. It contains no executable crypto.

**Delivery slices** (Principle III), each independently shippable and testable:

| Slice | Story | Delivers |
|-------|-------|----------|
| 1 | US1 (P1) | Registration with no-recovery acknowledgement and master password strength enforcement, key hierarchy, unlock, one encrypted secret, auto-lock, password change with server-enforced session re-auth, the forgotten-password dead-end screen, and account deletion |
| 2 | US2 (P2) | Built-in templates, typed secret forms, masked sensitive fields |
| 3 | US3 (P3) | Client-side search, folders, tags |
| 4 | US4 (P4) | Multiple vaults, invitations (including pending invitations to non-users), Owner/Editor/Viewer roles, revocation with resumable key rotation, activity log |
| 5 | US5 (P5) | TOTP enrolment, backup codes, sign-in history, security notifications |
| 6 | US6 (P6) | Custom templates, custom fields, template versioning |
| 7 | US7 (P7) | PWA install, offline encrypted cache, encrypted export/restore |

## Complexity Tracking

> Recorded per the Development Workflow gate: complexity must be justified in the plan.

| Cost accepted | Why needed | Simpler alternative rejected because |
|---------------|------------|--------------------------------------|
| Four-layer key hierarchy (Master → User → Vault → payload) rather than encrypting payloads directly with the master-derived key | Master password change (FR-005), sharing without password disclosure (FR-023), and revocation without re-keying other vaults (FR-024) each require an indirection layer | Direct derivation would force re-encryption of every secret on password change, make sharing impossible without disclosing a password, and couple revocation in one vault to all others |
| Client-side search over a downloaded encrypted index, instead of server-side query | The server cannot read titles or field values, so it cannot filter or rank them (Principle I). Titles are treated as sensitive because "Chase Bank" leaks the account's existence | Server-side search requires either plaintext titles or searchable encryption; the first breaks the core guarantee, the second is a research-grade dependency with known leakage for a 5,000-item working set that fits in memory |
| Vault Key rotation and bulk re-encryption on member revocation | Constitution Principle II requires revocation to remove the ability to decrypt future data; a revoked member may have cached the old Vault Key | Simply deleting the membership row leaves a member who retained the key able to read anything they already synced and anything re-fetched with that key |
| Three top-level packages instead of one | Cryptography must be client-only; `shared/` exists so the boundary is type-checked rather than conventional | A single package would let server code import client crypto helpers, making a Principle I violation a one-line mistake rather than a compile error |
| Two live vault key generations during a rotation, with wraps in a separate `VaultKeyWrap` table | FR-082 requires the vault stay usable while re-encrypting; FR-083 forbids a partly-readable vault. Both hold only if members can open old and new rows simultaneously | A single live generation forces the all-or-nothing transaction of the previous draft, which locks the vault for every member for the duration and loses all progress on interruption |
| A `VaultRotation` job with a cursor, rather than one request | 5,000 secrets over a slow uplink cannot be one transaction, and FR-083 requires an interrupted rotation to resume rather than roll back | A single bulk request either times out or discards completed work; retrying from zero on a flaky connection may never converge |
| A `VaultInvitation` entity that grants nothing and holds nothing | FR-066/067 — the recipient has no keypair until they register, so there is no key to wrap and nothing safe to put in an email or link | Putting a temporary key in the invitation puts vault-opening material into email, and a server-held recipient keypair violates Principle I outright |

**Rejected complexity, recorded so it is not re-added**: the `macKey` half of the StretchedMasterKey
was removed on 2026-09-01. Every payload uses AES-256-GCM, which authenticates internally, so the
second key had no consumer — and unused key material tends to acquire the wrong one.
