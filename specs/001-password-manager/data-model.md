# Data Model: Password Manager

**Date**: 2026-08-26 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

**Reading key**: 🔒 marks a column the server stores but can never read — a ciphertext envelope as
defined in [contracts/crypto-envelope.md](./contracts/crypto-envelope.md). Everything unmarked is
plaintext metadata the server needs to route, authorize, and index.

---

## Entity overview

```text
User ──1:1── PersonalVault
 │              │
 │         VaultMembership ──*── Vault ──*── Secret ──*── SecretFieldValue 🔒
 │         (role, status)     │      │
 │              │             │      ├── Folder 🔒
 │         VaultKeyWrap 🔒    │      ├── Tag 🔒
 │         (one per member    │      ├── ActivityLogEntry (append-only)
 │          per keyVersion)   │      ├── VaultInvitation  (no key material)
 ├── Session                  │      └── VaultRotation    (resumable job)
 ├── SignInEvent              │
 ├── TotpEnrolment 🔒         └── uses ─▶ TemplateVersion ──*── Template
 ├── BackupCode
 └── UserKeyring 🔒
```

---

## Core entities

### User

Identity and the root of the key hierarchy.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `email` | citext | Unique. Also the Argon2id salt input (research.md §2) |
| `emailVerifiedAt` | timestamptz | Null until verified; required before the user can **gain access** to a shared vault. An invitation may be addressed to an unverified or unregistered address and held pending (FR-066) |
| `authHashDigest` | bytea | Server-side Argon2id digest **of the client's AuthHash** — never of the master password |
| `kdfAlgorithm` | enum | `argon2id` \| `pbkdf2` (fallback) |
| `kdfMemoryKib`, `kdfIterations`, `kdfParallelism` | int | Per-user, so parameters can be raised without breaking existing accounts |
| `recoveryAcknowledgedAt` | timestamptz | Not null — the account cannot exist without the no-recovery acknowledgement (FR-010) |
| `autoLockMinutes` | int | Default 15, constrained `1..15` (FR-007) |
| `offlineAccessEnabled` | bool | Per-account default; per-device override (FR-059) |
| `deletionRequestedAt` | timestamptz | Starts the 30-day purge window (research.md §8) |

**Validation**: `email` unique and normalized (lowercased, trimmed) before hashing or salting.
`autoLockMinutes` MUST NOT exceed 15 — enforced by a check constraint, not only application code,
because the constitution states it as a ceiling.

### UserKeyring 🔒

Separated from `User` so that the wrapped key material has its own lifecycle and a password change
touches exactly one row.

| Field | Type | Notes |
|-------|------|-------|
| `userId` | uuid | PK, FK → User |
| `wrappedUserKey` | 🔒 bytea | UserKey sealed under the StretchedMasterKey |
| `publicKey` | bytea | RSA-4096 SPKI — **plaintext by design**; others need it to share with this user |
| `wrappedPrivateKey` | 🔒 bytea | RSA private key (PKCS#8) sealed under the UserKey |
| `rotatedAt` | timestamptz | Advances on master password change |

**Why this shape**: a master password change rewraps `wrappedUserKey` and nothing else. No secret,
no vault, and no share is touched — which is what makes FR-005 an O(1) operation.

### Vault

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `ownerId` | uuid | FK → User |
| `name` | 🔒 bytea | Encrypted — a vault named "Divorce Lawyer" leaks on its own |
| `kind` | enum | `personal` \| `standard`. Exactly one `personal` per user (FR-018), enforced by a partial unique index |
| `keyVersion` | int | Highest live generation. Increments when a rotation opens; rows may lag until it closes (research.md §11) |
| `nameKeyVersion` | int | Which generation encrypted `name`. Tracked separately because `name` lives on this row and cannot carry its own version column |

**`name` is encrypted under the VaultKey**, not under any member's UserKey — every member must be
able to read the vault's name, and only the VaultKey is shared among them. This means the vault name
is subject to rotation exactly like a secret, which is what `nameKeyVersion` records.

**Lifecycle**: `personal` vaults cannot be deleted or shared away; deleting a `standard` vault with
other members requires explicit confirmation (FR-021).

### VaultMembership

The authorization record and the per-member key escrow, in one row.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `vaultId`, `userId` | uuid | FK; unique together |
| `role` | enum | `owner` \| `editor` \| `viewer` (FR-031) |
| `status` | enum | `invited` \| `active` \| `revoked` |
| `invitedBy` | uuid | FK → User |
| `acceptedAt`, `revokedAt` | timestamptz | |

**State transitions**:

```text
(none) ──invite──▶ invited ──accept──▶ active ──revoke──▶ revoked
                      │                   │                  │
                      └──decline──▶ (deleted)                └──re-invite──▶ invited
                                                    (fresh VaultKeyWrap at the current keyVersion)
```

**Validation**: a vault MUST always retain at least one `active` member with role `owner` (FR-028) —
enforced in a transaction on every revoke, role change, and delete, not by trigger alone.

The wrapped key no longer lives on this row. It moved to `VaultKeyWrap` because a vault mid-rotation
has two live key versions and a member needs both (research.md §11).

### VaultKeyWrap 🔒

One row per member per live key version. This is the table that makes resumable rotation possible.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `membershipId` | uuid | FK → VaultMembership; unique with `keyVersion` |
| `keyVersion` | int | Which VaultKey generation this wrap opens |
| `wrappedVaultKey` | 🔒 bytea | VaultKey sealed to **this member's** RSA public key (RSA-OAEP), or under the owner's UserKey for a personal vault |
| `createdAt` | timestamptz | |

**Validation**: revoking a member deletes **every** wrap for that membership, at all versions, in the
same transaction that sets `status = revoked` (FR-080). Deleting only the current version would leave
the member able to open older rows during a rotation.

### VaultInvitation

An invitation to an address that may not have an account yet (FR-066 to FR-071).

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `vaultId` | uuid | FK → Vault |
| `inviteeEmail` | citext | Normalized. **Not** an FK — the account may not exist |
| `role` | enum | Role to grant on completion |
| `invitedBy` | uuid | FK → User |
| `state` | enum | `pending` \| `ready` \| `completed` \| `withdrawn` \| `expired` |
| `createdAt`, `expiresAt` | timestamptz | 14-day expiry (FR-071) |
| `completedAt`, `membershipId` | timestamptz, uuid? | Set when an Owner completes it |

**There is deliberately no key column on this table.** FR-067 forbids storing anything that could
grant vault access while an invitation is pending, and the reason is structural, not cautionary: the
recipient has no keypair yet, so no correct wrap can exist (research.md §12).

**State transitions**:

```text
                 recipient registers          owner completes
      pending ──────────────────────▶ ready ──────────────────▶ completed  (terminal)
         │                              │
         └──────────┬───────────────────┘
                    ▼
        withdrawn (by an Owner)  /  expired (14 days)          (both terminal)
```

Only `pending` and `ready` are live states; the other three are terminal. `completed` creates a
`VaultMembership` with `status = invited` — the recipient still accepts to become `active`, so the
existing membership state machine is unchanged.

**Validation**: at most one non-terminal invitation per `(vaultId, inviteeEmail)`. An invitation whose
address already has an active membership is refused. Reads of this row by anyone other than a vault
Owner disclose nothing about the vault (FR-066); the recipient sees only that an invitation exists.

### VaultRotation

The resumable re-encryption job opened by a revocation (FR-081 to FR-084, research.md §11).

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `vaultId` | uuid | FK → Vault; unique where `state = 'running'` — one rotation at a time |
| `fromVersion`, `toVersion` | int | |
| `state` | enum | `running` \| `completed` \| `failed` |
| `cursor` | uuid? | Last re-encrypted `Secret.id` in stable id order; the resume point for the secret walk. Folders, tags, and the vault name are too few to need a cursor — they go in one final batch, and the close precondition is what guarantees they happened |
| `totalCount`, `doneCount` | int | Drives the progress indicator (FR-082) |
| `startedBy` | uuid | FK → User — the Owner whose device performs the work |
| `startedAt`, `completedAt` | timestamptz | |

**Validation**: a rotation may only close when no row in the vault remains at `fromVersion`. Closing
deletes every `VaultKeyWrap` at `fromVersion`.

### Secret

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | PK |
| `vaultId` | uuid | FK → Vault |
| `templateVersionId` | uuid | FK → TemplateVersion — pins the shape this secret was authored against (FR-033) |
| `title` | 🔒 bytea | Encrypted; search happens client-side (research.md §4) |
| `folderId` | uuid? | FK → Folder, nullable |
| `fieldValues` | 🔒 jsonb | `{ fieldId: envelope }` — **every** field value sealed individually, whether or not the template marks it sensitive |
| `keyVersion` | int | Which VaultKey generation encrypted this row. May lag the vault's during a rotation |
| `updatedAt`, `revision` | timestamptz, int | `revision` powers optimistic concurrency (see Concurrency below) |

**There is no `deletedAt`.** Deletion is a real `DELETE` (FR-053, FR-076): no trash, no restore, no
purge job, and no deleted rows leaking into lists, search, exports, or counts (research.md §14).

**Why every value is encrypted, not just the sensitive ones**: the 2026-08-26 draft stored
non-sensitive values as plaintext in the JSONB. That was revised during implementation because it
buys nothing and costs something. It buys nothing because search runs entirely client-side
(research.md §4), so the server can do no filtering, ranking, or indexing on a plaintext value. It
costs something because "non-sensitive" is a template author's judgement, and the built-in Website
Account template marks `username` non-sensitive — which would have put a plaintext list of every
account name a user holds in the database. FR-041 sets encryption of sensitive fields as a floor,
not a ceiling. The `sensitive` flag still drives **masking** in the interface; it no longer decides
whether a value is encrypted.

**Why `fieldValues` is JSONB**: adding a template field must require no migration (FR-032, Principle
V). A per-field column model would make every new custom field a schema change, which is the exact
failure mode Principle V exists to prevent.

### Template / TemplateVersion

Split so that editing a template cannot retroactively break secrets already authored under it.

**Template**: `id`, `ownerId` (null = built-in), `kind` (`builtin` | `custom`), `currentVersionId`.

**TemplateVersion**: `id`, `templateId`, `version` (int), `name`, `fields` (jsonb), `createdAt`.

`fields` is an ordered array of `{ id, label, type, required, sensitive, order }`, where `type` is one
of `text | password | email | url | number | date | totp | multiline`. The `sensitive` flag is what
drives encryption (FR-034) — **which fields are secret is a property of the data, not of the
rendering code**, exactly as Principle V requires.

**Built-in templates seeded** (FR-029): Website Account, Credit Card, Identity/PAN Card, Secure Note.

**Validation**: field `label`s unique within a version (FR-036). Removing a field creates a new
version and requires the user to confirm the data-loss warning (FR-035); prior versions remain, so
existing secrets stay readable.

### Folder / Tag

Both scoped to a single vault; both have 🔒 encrypted names for the same reason vault names are.
`Folder` is 1:many with `Secret`; `Tag` is many:many via `SecretTag`. Deleting a folder requires the
caller to pass an explicit disposition (`orphan` or `cascade`), so the API cannot silently destroy
contents (FR-041).

Both carry `keyVersion` (int), for the same reason `Secret` does: their names are encrypted under the
VaultKey, so a rotation must rewrite them and must be able to tell which generation each is at.
Omitting this column is what makes a rotation destroy folder and tag names — `rotation/close` cannot
refuse on rows it cannot see.

---

## Security and audit entities

### Session

`id`, `userId`, `tokenDigest` (SHA-256 of the opaque token — the token itself is never stored),
`deviceLabel`, `ipHash`, `createdAt`, `lastSeenAt`, `expiresAt`, `revokedAt`, `reauthRequiredAt`.

Absolute lifetime 7 days. **No key material** — the vault key lives only in the browser's memory, so a
stolen session token grants API access but decrypts nothing (FR-016).

**`reauthRequiredAt`** is set on every *sibling* session inside the master-password-change transaction
(FR-072). While it is set, the session guard refuses every route except `POST /auth/reauth` with
`401 REAUTH_REQUIRED` (FR-073). This is enforced server-side because a client already holding the
unwrapped UserKey can ignore any client-side prompt — see research.md §13. Re-auth clears the flag
and does **not** re-challenge the second factor (FR-074).

### SignInEvent

`id`, `userId`, `outcome` (`success` | `bad_password` | `bad_totp` | `rate_limited`), `at`,
`coarseLocation`, `deviceLabel`. Retained 90 days (research.md §9).

### TotpEnrolment 🔒 / BackupCode

`TotpEnrolment`: `userId` (PK), `wrappedSecret` 🔒 (TOTP seed sealed under the UserKey — the server
cannot read it), `confirmedAt`, `lastUsedStep` (int, rejects replay within a step per FR-010).

`BackupCode`: `id`, `userId`, `codeDigest`, `usedAt`. Single-use (FR-011).

**Note on the TOTP seed**: sealing it under the UserKey means verification happens client-side and the
client presents proof to the server. This keeps Principle I intact but means TOTP cannot gate the API
before unlock — see the honest limitation in the Contracts README.

### ActivityLogEntry

`id`, `vaultId`, `actorId`, `subjectId`, `action`, `at`, `metadata` (jsonb).

`action` ∈ `invited | invitation_ready | invitation_completed | invitation_withdrawn |
invitation_expired | accepted | declined | revoked | role_changed | rotation_started |
rotation_completed | secret_deleted | exported | vault_created | vault_deleted`.

**`secret_deleted` carries the secret's id and nothing else** (FR-079). Because titles are encrypted
and the ciphertext is destroyed with the row, the log cannot name what was deleted. That legibility
cost is accepted rather than worked around by retaining a title the user asked to destroy.

**Append-only, enforced at the database level**: `REVOKE UPDATE, DELETE` on the table for the
application role. Principle II requires the log be unalterable, and a convention in application code
is not that. Covers FR-025, FR-034 (role changes), and FR-065 (exports).

---

## Cross-cutting rules

**Concurrency (spec edge case: two members editing one secret)**: every `Secret` write sends the
`revision` it was read at; the server rejects a mismatch with `409 Conflict` and returns the current
row so the client can present a merge. This is why the second save never silently discards the first.

**Key rotation integrity**: a vault mid-rotation holds **two live key versions**, and every remaining
active member holds a `VaultKeyWrap` for both. Each `Secret` carries its own `keyVersion`; readers
select the key per row, writers always use `Vault.keyVersion`. The invariant is therefore not that
the versions agree, but that **every version present on any row is one the remaining members can
open** — enforced by never deleting a `VaultKeyWrap` until no row references its version.

This replaces the all-or-nothing transaction of the 2026-08-26 draft. FR-082 requires the vault stay
usable while re-encryption runs, and FR-083 forbids a state where some secrets are readable and others
are not; a single live key version cannot satisfy both (research.md §11). Batches are individually
transactional and advance `VaultRotation.cursor`, so a crash resumes rather than rolls back.

**Everything encrypted under the VaultKey must rotate together.** That is four things, not one:
`Secret.fieldValues` and `Secret.title`, `Folder.name`, `Tag.name`, and `Vault.name`. Each carries a
`keyVersion` (`nameKeyVersion` for the vault), and `rotation/close` MUST refuse while **any** of them
still reads `fromVersion`. Enumerating only secrets would let close succeed and destroy the old
generation while folder, tag, and vault names were still encrypted under it — permanent, silent loss
of exactly the labels a user needs to navigate the vault. Any future column encrypted under the
VaultKey must be added to this set and to the close precondition.

**Deletion cascade**: deleting a `User` (after the 30-day window) cascades to sessions, sign-in
events, TOTP, backup codes, keyring, key wraps, and memberships. Pending invitations addressed to
that user's email are deleted.

`Vault.ownerId` is deliberately **`Restrict`, not `Cascade`** — a database-level cascade cannot tell
a personal vault from a shared one, and cascading would silently destroy a shared vault for every
other member the moment its owner closed their account. Account deletion is therefore an
application-level sequence: delete the owner's personal vault and its secrets, then for each shared
vault they own either transfer ownership or refuse the deletion, per FR-024's rule that a vault with
other members cannot be deleted out from under them. The database failing loudly on a naive
`DELETE FROM "user"` is the intended behaviour, not an oversight. (Found by running
`scripts/db-roundtrip.ts` against a real server; the previous wording implied a cascade that would
have been actively unsafe.)

It does **not** delete
`ActivityLogEntry` rows in other people's vaults — those are another owner's security record and are
pseudonymized instead (research.md §8).

**Indexes**: `Secret(vaultId)` for list and `Secret(vaultId, keyVersion, id)` to walk a rotation
cursor; `VaultMembership(userId, status)` for the vault list on unlock; `VaultKeyWrap(membershipId,
keyVersion)` unique; `Folder(vaultId, keyVersion)` and `Tag(vaultId, keyVersion)` for the rotation-close precondition;
`VaultInvitation(inviteeEmail, state)` to find invitations at registration, and
partial unique `(vaultId, inviteeEmail) WHERE state IN ('pending','ready')`; `Session(tokenDigest)`
unique; `SignInEvent(userId, at DESC)`; partial unique `Vault(ownerId) WHERE kind = 'personal'`;
partial unique `VaultRotation(vaultId) WHERE state = 'running'`.

**What the server can infer even though it cannot decrypt** — stated plainly because it is the honest
boundary of the guarantee: how many vaults and secrets a user has, when each was created and last
modified, who shares a vault with whom, the size of each ciphertext, and the user's access patterns.
Titles, values, folder names, tag names, and vault names are all opaque to it.
