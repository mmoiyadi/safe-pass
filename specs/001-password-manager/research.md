# Phase 0 Research: Password Manager

**Date**: 2026-08-26 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

Every unknown in the plan's Technical Context is resolved below. Sections 8 and 9 resolve the two
decisions the spec explicitly deferred to planning.

---

## 1. Key hierarchy

**Decision**: Four layers — Master Key → User Key → Vault Key → payload.

```text
masterPassword ──Argon2id(salt = normalized email)──▶ MasterKey (32B)
                                                        │
                        ┌───────────────────────────────┴──────────────────────────┐
                   HKDF-Expand                                              Argon2id(1 pass)
                        │                                                          │
              StretchedMasterKey (32B)                                        AuthHash (32B)
              = encKey — no separate MAC key                             sent to server at login
                        │                                          server stores Argon2id(AuthHash)
                        ▼
     AES-256-GCM-unwrap ──▶ UserKey (32B, random at registration)
                                  │
                ┌─────────────────┴─────────────────┐
                ▼                                   ▼
      unwraps user's RSA private key      AES-256-GCM-unwrap ──▶ VaultKey (personal vault)
      (public key stored in clear)
                │
                ▼
      RSA-OAEP-unwrap ──▶ VaultKey (each shared vault, wrapped per member)
                                  │
                                  ▼
                    AES-256-GCM ──▶ secret field values, titles, folder names, tag names
```

**Rationale**: Each layer exists because a specific requirement demands it, and removing any one
breaks that requirement:

| Layer | Requirement it satisfies | What breaks without it |
|-------|--------------------------|------------------------|
| MasterKey from password | FR-013 — encryption keyed by the master password | Nothing to derive from |
| AuthHash separate from encryption key | FR-014 — server must not hold anything that decrypts | Server would receive the encryption key at login |
| UserKey wrapped by StretchedMasterKey | FR-005 — password change keeps secrets readable | Password change would re-encrypt every secret |
| RSA keypair under UserKey | FR-023 — members share without learning each other's passwords | Sharing would require disclosing a password or a symmetric key out of band |
| Per-vault VaultKey | FR-024, Principle II — revoke one vault without re-keying others | Revocation anywhere would force re-keying everything |

**Alternatives considered**:

- *Direct password-to-payload encryption.* Rejected: password change becomes an O(n) re-encryption of
  the whole vault, and sharing is impossible.
- *Symmetric-only sharing (wrap VaultKey with a shared secret).* Rejected: requires an out-of-band
  channel to deliver the secret, and revocation cannot be enforced.
- *A separate `macKey` half in the StretchedMasterKey.* Rejected on review during the 2026-09-01
  clarification pass. The 64-byte `encKey ‖ macKey` split is inherited from designs built on AES-CBC
  + HMAC, where a distinct MAC key is essential. Every payload here uses AES-256-GCM, which
  authenticates as part of the AEAD, so `macKey` would have no consumer. Unused key material invites
  a later contributor to find a use for it — most likely a use that breaks key separation — so HKDF
  now expands to 32 bytes and the encryption key is the whole output.
- *X25519 instead of RSA-OAEP for key wrapping.* Genuinely better (smaller keys, faster), but
  WebCrypto support for X25519 is uneven across the Safari versions in the target matrix. RSA-OAEP
  4096 is universally available via WebCrypto with no WASM dependency. Revisit when X25519 lands
  everywhere in the support window.

---

## 2. Key derivation parameters

**Decision**: Argon2id, `m = 64 MiB`, `t = 3`, `p = 1`, 32-byte output. Salt is derived from the
normalized (lowercased, trimmed) email address for the MasterKey, so derivation is reproducible on
any device without a server round-trip before authentication. The address is hashed to a fixed
32-byte salt first, because Argon2 requires at least 8 bytes and a legal address can be shorter. Parameters are stored per-user and returned by a
pre-login endpoint, so they can be raised later without breaking existing accounts.

**Rationale**: OWASP's floor for Argon2id is `m=19MiB, t=2, p=1`; a password manager should sit well
above the floor because the master password is the single point of failure. `p=1` is chosen over
higher parallelism because the browser WASM build is single-threaded, so `p>1` costs wall-clock time
without adding real resistance. At 64 MiB / t=3 derivation lands around 300–600 ms on a mid-range
2023 phone, inside the ≤2s unlock budget with headroom.

**Alternatives considered**:

- *PBKDF2-SHA256 (600k iterations).* Available natively in WebCrypto with no WASM dependency, but it
  is not memory-hard, so GPU and ASIC attacks are dramatically cheaper. Kept only as a documented
  fallback if `hash-wasm` fails to load, and if used the account is flagged for upgrade on next login.
- *scrypt.* Memory-hard and acceptable under the constitution, but Argon2id is the current
  recommendation and has better-defined parameter guidance.
- *Random per-user salt instead of email.* Marginally better (avoids cross-service salt reuse for
  users with the same email elsewhere), but requires an unauthenticated endpoint that confirms
  whether an account exists — which directly violates FR-003's requirement that responses not reveal
  account existence. Email-as-salt keeps that endpoint uniform: it returns parameters for any input,
  real or not.

---

## 3. Payload encryption

**Decision**: AES-256-GCM via WebCrypto, 96-bit random nonce per encryption, no additional
authenticated data beyond a version byte. Ciphertext is stored in the envelope format defined in
[contracts/crypto-envelope.md](./contracts/crypto-envelope.md).

**Rationale**: AEAD is mandated by Principle I. AES-GCM is hardware-accelerated on every target
platform and native to WebCrypto, so there is no WASM dependency in the hot path. A random 96-bit
nonce per encryption keeps collision probability negligible at this scale, and because every write
generates a fresh nonce there is no counter state to persist or corrupt. GCM's authentication tag is
what satisfies FR-015 — a tampered ciphertext fails to decrypt rather than yielding wrong plaintext.

**Alternatives considered**:

- *XChaCha20-Poly1305.* Larger nonce removes even theoretical collision concern, but it is not in
  WebCrypto and would add a WASM dependency for no practical gain on hardware with AES-NI.
- *AES-CBC + HMAC (encrypt-then-MAC).* Works, but composes two primitives by hand where a single AEAD
  call suffices — more room for an implementation mistake, which Principle I explicitly guards against.

---

## 4. Search over encrypted data

**Decision**: Client-side search. On unlock, the client fetches metadata rows for all accessible
secrets, decrypts titles and non-sensitive field values in memory, and builds an in-memory inverted
index. Search never contacts the server.

**Rationale**: Titles are sensitive metadata — "Chase Bank" reveals the existence of the account even
with the password encrypted — so titles are encrypted, and an encrypted title cannot be filtered or
ranked server-side. A 5,000-secret vault is roughly 2–5 MB of metadata; indexing it takes tens of
milliseconds and searching it takes low single-digit milliseconds, comfortably inside SC-003's 1s
budget. This also makes offline search work for free (FR-054).

**Alternatives considered**:

- *Plaintext titles, server-side search.* Simplest and fastest, and rejected outright: it hands the
  server a readable map of every account the user holds, defeating the point of the product.
- *Searchable symmetric encryption / encrypted indexes.* Enables server-side search over ciphertext,
  but every practical scheme leaks access and search patterns, and the implementations are
  research-grade. Disproportionate for a working set that fits in memory.
- *Server-side search over a blind index of tokens.* Requires deterministic encryption of tokens,
  which leaks frequency and enables dictionary attacks on common titles.

---

## 5. Sharing, roles, and revocation

**Decision**: A VaultKey is wrapped once per member with that member's RSA public key and stored on
the membership row. Inviting wraps a copy; revoking deletes it **and rotates the VaultKey**,
re-encrypting the vault's payloads under the new key and re-wrapping it for every remaining member.
Roles (Owner/Editor/Viewer) are enforced server-side on every request.

**Rationale**: Deleting the membership row alone is insufficient — a revoked member may have cached
the VaultKey in memory or in an offline copy, and could decrypt anything they had already synced or
could still obtain. Principle II requires revocation to remove the ability to decrypt *future* data,
which only rotation achieves.

**Honest limitation, carried into the design**: rotation cannot retroactively protect data the
revoked member already read or copied. It bounds future exposure, not past. The spec's SC-005 (60
seconds) is therefore a guarantee about *server-side access*, and offline copies are handled
separately by FR-058, which discards a device's cached copy on revocation — but only once that device
next reaches the network. A revoked member's offline device retains readable ciphertext until then.
This is inherent to offline access and is documented rather than papered over.

**Rotation cost and execution model**: re-encrypting 5,000 secrets client-side is roughly 1–2 seconds
of AES-GCM work plus a bulk upload. Per the 2026-09-01 clarification it runs as a **resumable
background job** on the revoking Owner's device rather than a blocking foreground operation — see
§11 for the mechanism, which is the part with real design consequences.

**Alternatives considered**:

- *No rotation on revoke.* Cheaper, and rejected: it makes revocation cosmetic.
- *Lazy rotation (rotate on next write).* Leaves a window where the revoked member's key still opens
  new data. Rejected for the same reason.

---

## 6. Offline read-only PWA

**Decision**: Workbox precaches the app shell. On successful unlock while online, the client writes
the vault's **ciphertext** (exactly as received from the server, still encrypted under the VaultKey)
plus the wrapped-key material into IndexedDB. On an offline unlock, Argon2id runs locally, unwraps
the cached keys, and decrypts from the cache. Writes are refused offline (FR-057). The cache carries
a `refreshedAt` timestamp and is discarded after 30 days, on sign-out, and on revocation.

**Rationale**: Storing ciphertext rather than plaintext means a stolen device yields nothing without
the master password, satisfying FR-055 and SC-013. Storing it *at all* is new exposure compared with
an online-only design, which is why expiry and the per-device off switch (FR-059) exist. Crucially,
the derived keys themselves are never written — only the same wrapped blobs the server already holds
— so FR-016 is preserved: the decrypted key exists only in memory, for the session.

**Alternatives considered**:

- *Cache decrypted data for speed.* Rejected outright — it would make device theft equivalent to full
  compromise.
- *Cache in `localStorage`.* Rejected: synchronous, size-limited, and string-only, forcing base64
  inflation of binary ciphertext. IndexedDB stores `ArrayBuffer` natively.
- *Origin Private File System.* Better for large blobs, but weaker Safari support and unnecessary at
  this data size.

---

## 7. Constitution security standards → implementation mapping

| Standard | Implementation |
|----------|----------------|
| TLS everywhere | HSTS with preload; API refuses plaintext HTTP |
| Bounded, revocable sessions | Opaque session token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie; server-side session table; 7-day absolute lifetime; revocable individually or in bulk (FR-006, FR-008) |
| Keys in memory only | Keys held as non-extractable `CryptoKey` where possible, in a module-scoped keyring cleared on lock/logout/`visibilitychange` teardown; never serialized |
| Auto-lock ≤15 min | Idle timer on user interaction; default 15 min, user-configurable downward; clears the keyring and forces re-derivation |
| TOTP (RFC 6238) | 30s step, 6 digits, ±1 step drift window; used counters cached per user to reject replay within the same step (FR-010) |
| Log redaction | Structured logger with a deny-list serializer; ciphertext fields typed as `Opaque<T>` in `shared/` so logging one is a type error |
| Rate limiting | Per-account and per-IP token buckets on login, unlock, TOTP, and invitation endpoints; uniform timing and response shape (FR-003, FR-004) |
| Pinned crypto dependencies | Exact versions, lockfile committed, `npm audit` + Dependabot in CI, review required for any change to `frontend/src/crypto/` |
| Clipboard clearing | 30s timer, overwrite-then-clear, with a visible countdown (FR-045) |

---

## 8. RESOLVED DEFERRAL — Regulatory obligations

**Decision**: Build to GDPR and India DPDP Act expectations; do not pursue formal certification.
Treat PCI DSS as out of scope and record the reasoning.

**What this adds to the build**:

- **Right to deletion**: account deletion purges the user row, sessions, memberships, personal vault
  and its secrets, and the user's custom templates, within 30 days. Activity-log rows naming the user
  are pseudonymized rather than deleted, because they are another vault owner's security record.
- **Right to data portability**: a personal-data export distinct from the vault backup — account
  metadata, membership list, sign-in history, activity entries — in machine-readable JSON.
- **Breach notification**: an incident runbook with a 72-hour notification path, and enough
  server-side logging to determine *which accounts* were affected without being able to read them.
- **Retention**: sessions purged at expiry; sign-in history 90 days; activity log retained for the
  life of the vault; pending invitations expire at 14 days; **deleted secrets are removed
  immediately, with no retention window at all** (§14) — a stronger position than data-minimisation
  requires, and the one the user chose.

**Rationale**: The account metadata — email addresses, vault names, membership graphs, activity
records — is personal data under both regimes regardless of how well the vault contents are
encrypted. These rights are inexpensive to design in now and require a migration plus an audit to
retrofit. Certification is disproportionate for a single-operator deployment with no enterprise
customers demanding it.

**PCI DSS scoping argument** (recorded because "we store card numbers" invites the question): PCI DSS
applies to entities that store, process, or transmit cardholder data as part of payment
acceptance. This system does neither — it performs no payment transactions, has no acquirer or card
brand relationship, and stores card numbers only as user-authored ciphertext it cannot decrypt.
Guidance treats encrypted cardholder data as out of scope for an entity with no ability to decrypt it
and no access to the keys, which is precisely the property Principle I guarantees. **This is the
project's own reasoning, not a compliance opinion**; if the product ever gains a payment relationship
or an enterprise customer with contractual PCI obligations, it must be re-assessed by a QSA.

**Alternatives considered**: no compliance program (rejected — the obligations attach whether or not
they are planned for); full PCI scope treatment (rejected — expensive and, per the argument above,
not applicable).

---

## 9. RESOLVED DEFERRAL — Account security visibility

**Decision**: Ship both a sign-in history and email notifications for security-sensitive events.

- **Sign-in history**: successful and failed attempts, with timestamp, IP-derived coarse location,
  and user-agent-derived device description. Retained 90 days, visible in settings.
- **Notifications** sent to the account email on: sign-in from an unrecognized device, master password
  change, second-factor removal, backup-code use, and vault export.
- **Master password change requires re-entering the current master password**, not merely a valid
  session.

**Rationale**: This is a direct consequence of the no-recovery decision. In an ordinary product an
undetected takeover is recoverable — support resets the password. Here it is terminal: an intruder
with a live session who changes the master password locks the legitimate owner out permanently, and
the operator genuinely cannot help. The spec records this as an edge case; this is its answer.

Notification carries most of the weight. A history page only helps a user who already suspects
something and goes looking; an email reaches someone with no reason to suspect anything yet, which is
the actual failure mode. Requiring the current master password to change it closes the window
directly: a stolen *session* is then no longer sufficient to cause permanent loss.

**Privacy note**: sign-in history is itself personal data (IP-derived location), covered by the
retention and deletion rules in §8.

**Alternatives considered**: history only (rejected — passive, reaches nobody in time); notifications
only (rejected — no way to investigate after the alert); neither (rejected — leaves the spec's
takeover edge case unanswered while the consequence is permanent).

---

## 10. Testing strategy for security-critical code

**Decision**: `backend/tests/security/` and `frontend/tests/crypto/` are written test-first per
Principle IV, using published known-answer vectors where they exist.

| Area | Vectors / negative cases |
|------|--------------------------|
| Argon2id | RFC 9106 test vectors |
| HKDF-SHA256 | RFC 5869 test vectors |
| AES-256-GCM | NIST CAVP GCM vectors |
| TOTP | RFC 6238 reference vectors, plus replay-within-step and ±1-step drift |
| Envelope | round-trip; single-bit ciphertext flip must fail to decrypt; nonce reuse detection |
| Authorization | every vault route exercised as Owner, Editor, Viewer, revoked member, and non-member |
| Session | expired, revoked, and cross-user token reuse |
| Unlock | wrong master password; correct password after a password change; offline unlock against a stale cache |

**Rationale**: These are the paths that fail silently. A wrong-but-plausible ciphertext or a missing
authorization check produces no visible error, so the negative case has to be asserted explicitly or
it is never observed.

---

## 11. Resumable key rotation (clarified 2026-09-01)

**Decision**: Revocation refuses the member at the server immediately and independently. The
re-encryption it requires then runs as a **resumable background job** on the revoking Owner's device.
During the job the vault holds **two live key versions**, and every remaining member can open both.

**The problem this solves**: FR-082 requires the vault to stay readable and writable while
re-encryption runs, and FR-083 forbids leaving it in a state where some secrets are readable and
others are not. Those two are only compatible if members can decrypt old-version and new-version rows
at the same time. A single-key-per-vault model cannot express that, so the original all-or-nothing
transaction in the Phase 1 data model does not survive this requirement.

**Mechanism**:

1. Revoke: set membership `revoked`, delete **all** of that member's wrapped keys. Server-side
   authorization now refuses them — this is what satisfies FR-080 and SC-005, and it does not wait
   for any re-encryption.
2. Open a rotation job: generate `VaultKey(v+1)` on the Owner's device, wrap it for every remaining
   active member, and store those wraps **alongside** the existing `v` wraps.
3. Re-encrypt in batches, advancing a cursor. Each batch is one transaction; a crash resumes from the
   cursor. **The batches must cover everything the old key protects, not just the secrets**: secret
   field values and titles, folder names, tag names, and the vault's own name. Each carries a
   `keyVersion` (`nameKeyVersion` on the vault) so the walk can tell what is still outstanding.
   Only secrets need a cursor — they are the high-cardinality set. Folders, tags, and the vault name
   number in the tens and are rewritten in one final batch; if that batch is lost to a crash, step 4
   refuses to close and the client simply resends it.
4. Close: only once **none** of those four still reads `v` — then delete every `v` wrap and destroy
   the old key. Closing on the secrets alone would destroy the only key that opens the folder, tag,
   and vault names, silently and permanently. FR-081 states the set; anything encrypted under the
   VaultKey in future must be added to it and to this precondition.

**Reading during rotation**: each row carries its own `keyVersion`; the client selects the key for
that row. Writes always use the highest version the writer holds, so the job never chases its own
tail.

**Rationale**: it makes revocation's security-relevant half — cutting off the revoked member —
instant and atomic, while the expensive half degrades gracefully. An interrupted job leaves a
consistent, fully readable vault that is merely partly re-encrypted, which is exactly the state
FR-084 requires be surfaced to owners.

**Honest limitation**: until the job completes, the old key still opens any row not yet rewritten. A
revoked member who kept that key and retained a copy of the ciphertext can still read those rows.
Server-side refusal means they cannot *fetch* new ciphertext, so this is bounded by what they already
hold — the same bound described in §5. FR-084 requires telling owners this rather than implying
revocation is instantaneously complete.

**Alternatives considered**:

- *Blocking foreground rotation (the original design).* Simpler — one transaction, one key version
  ever live. Rejected because 5,000 secrets over a slow uplink locks the vault for every member, and
  an interrupted transaction rolls back all of the work.
- *Server-side re-encryption.* Impossible: the server has no key. Not a tradeoff, a hard constraint.
- *Rotate lazily on next write.* Rejected in §5 and still rejected: it leaves no bound at all on when
  the old key stops opening current data.

---

## 12. Pending invitations to non-users (clarified 2026-09-01)

**Decision**: An invitation may be addressed to an email with no account. It is stored as a
`VaultInvitation` row holding **no key material of any kind**, and it grants nothing. When the
recipient registers, the invitation becomes *ready* and owners are notified; an Owner then completes
it, which wraps the VaultKey to the newcomer's freshly created public key.

**Why it cannot be done at invite time**: sharing requires wrapping the VaultKey to the recipient's
RSA public key. A person with no account has no keypair — it is generated at registration under their
own master password. There is no key to wrap to, and no way to manufacture one without the operator
holding key material, which Principle I forbids.

**Flow**:

```text
owner invites unknown@example.com
   └─▶ VaultInvitation { vault, email, role, state: pending }     ← no key material
       email sent: "you have been invited to a shared vault"      ← names no vault (FR-066)

recipient registers → keypair generated on their device
   └─▶ invitation state: ready; owners notified (FR-069)

owner's device: wrap VaultKey to recipient's public key
   └─▶ VaultMembership { status: invited, wrappedVaultKey }
       invitation state: completed

recipient accepts → status: active
```

**Rationale**: the alternative that feels natural — putting a key in the invitation link — is exactly
what FR-067 forbids, and for good reason: invitation links travel through email providers, get logged
by mail scanners, and sit in inboxes indefinitely. Holding no key material until a real public key
exists means a stolen invitation link grants nothing at all.

**Consequences accepted**:

- Access is **not immediate**. It needs an Owner online after the recipient registers. FR-068
  requires telling the inviting owner this rather than letting them assume it is instant.
- Invitations expire (FR-071), so a `pending` row cannot linger indefinitely against an address the
  owner may no longer intend to invite.
- The invitation email must not name the vault (FR-066), because the address is unverified and may
  simply be wrong.

**Alternatives considered**:

- *Refuse invitations to non-users.* Simplest, and rejected: it makes the common "invite my partner"
  case a dead end with instructions to go elsewhere first.
- *Server-held temporary keypair for the recipient.* Gives immediate access on registration, and
  rejected outright: the server would hold a private key that opens a vault, which is a direct
  Principle I violation regardless of how briefly it is held.

---

## 13. Session re-authentication after a master password change (clarified 2026-09-01)

**Decision**: A master password change marks every *other* session `reauthRequired`. Those sessions
stay established, but the **server refuses every request** from them until they present an AuthHash
derived from the new password. The second factor is not re-challenged.

**Why server enforcement is the whole point**: a password change does not change the UserKey — it
rewraps it. A device that already unwrapped the UserKey holds it in memory and can keep decrypting
indefinitely; nothing it holds has expired. A client-side "please re-enter your password" prompt is
therefore advisory, and an attacker's client simply ignores it. FR-073 exists to make the refusal
happen where the attacker has no vote.

**Mechanism**: `Session.reauthRequiredAt` is set on all sibling sessions inside the password-change
transaction. The session guard rejects every route except `POST /auth/reauth` with
`401 REAUTH_REQUIRED`. A successful re-auth clears the flag and returns the newly wrapped keyring so
the client can rebuild its key chain.

**Rationale for keeping the session rather than terminating it**: the user chose this over full
termination. It preserves device labels, session history, and the second-factor state, so the user
is not pushed through a full sign-in with a TOTP prompt on every device after a routine password
change. The security outcome is equivalent — no request succeeds without the new password — because
enforcement is server-side. Had it been client-side, terminating the sessions would have been the
only defensible option.

**Honest limitation**: a device that is offline at the time cannot be reached, and continues to read
its encrypted offline copy until it next connects. This is the same boundary described in §6 and §11,
and FR-075 requires telling the user at the point of change rather than implying every device is
locked out instantly.

---

## 14. Permanent deletion of secrets (clarified 2026-09-01)

**Decision**: Deleting a secret removes its row and ciphertext. There is no trash, no soft-delete
column, and no restore. The confirmation names the secret and states that the action cannot be
undone.

**Rationale**: this is the choice that matches the product's existing stance. The system already has
no password recovery and no operator-side escrow; retaining "deleted" ciphertext server-side for 30
days would contradict that posture by keeping data alive that the user believes is gone. It also
removes an entire class of state — deleted-but-present rows leaking into list queries, search
indexes, exports, and member counts.

**Consequences accepted**:

- An accidental deletion is unrecoverable except from a backup taken beforehand. FR-077 requires
  saying so at the point of deletion, not burying it in help text.
- In a shared vault the deletion is immediate for every member (FR-078).
- The activity log records the deletion with actor, subject id, and time, and **cannot record the
  secret's name** — titles are encrypted, and retaining the title ciphertext would be retaining a
  value the user just destroyed (FR-079). The log therefore shows that *a* secret was deleted, not
  which one by name. This is a genuine legibility cost and is accepted rather than worked around.

**Alternatives considered**:

- *30-day trash (the original assumption).* Standard in comparable products and rejected by the user
  on 2026-09-01. It would have made accidental deletion survivable at the cost of retaining data past
  the point the user asked for its destruction.
