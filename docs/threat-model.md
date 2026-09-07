# Threat model review

**Reviewed**: 2026-09-07 · **Scope**: the cryptographic and authentication surface
**Gate**: Constitution → Development Workflow ("changes touching cryptography, authentication,
authorization, or sharing MUST receive a review explicitly covering the threat model")

This is a review of what was built, not a restatement of what was designed. Where the two differ,
the difference is the finding. Every claim names the file or test that supports it, so a later
reader can check rather than trust.

---

## 1. What is being defended, and from whom

**The asset** is the plaintext of stored secrets — values, titles, folder and tag names, vault
names, and one-time-code seeds. Everything else is instrumental.

**The adversaries considered:**

| | Capability assumed |
|---|---|
| **A** Passive server operator | Reads the database, backups, and logs at will |
| **B** Database thief | One-time full dump, including backups |
| **C** Network attacker | Observes and modifies traffic |
| **D** Device thief | Physical possession of a signed-in device |
| **E** Revoked vault member | Held a valid key until a moment ago |
| **F** Malicious vault member | Currently holds a valid key |
| **G** Compromised application server | Serves arbitrary client code |

**Explicitly out of scope**: an adversary with code execution on an unlocked device; targeted
malware; coercion of the user. None of these is defensible by this design, and pretending
otherwise would be the most dangerous claim in the document.

---

## 2. Findings against each adversary

### A — Passive server operator · **Mitigated**

Encryption happens on the client; no server code path holds a key. Enforced structurally rather
than by discipline: `eslint.config.js` makes any `backend/**` import of `frontend/src/crypto` a
build failure, and `backend/tests/security/no-plaintext.test.ts` dumps the whole database after
seeding and asserts each known plaintext appears zero times.

**Residual**: metadata. Email addresses, the membership graph, sign-in history, and the sizes and
timestamps of everything are visible by construction. Stated in
[`security-model.md`](./security-model.md) rather than minimised.

### B — Database thief · **Mitigated**, with a caveat about guessing

Same protection as A, plus: the stored authentication value is a server-side Argon2id digest of
the client's AuthHash, so the dump does not even yield a replayable login credential.

**Residual**: offline guessing of weak master passwords. Argon2id at m=64 MiB, t=3 makes this
expensive per guess, and registration refuses passwords under 12 characters or a zxcvbn score
below 3 — but a determined attacker against a poor password will still win. Unfixable in
principle; the mitigation is the strength check at the only moment it can be applied.

### C — Network attacker · **Mitigated**, conditional on deployment

The master password never leaves the device. What is sent is the AuthHash, which authenticates
but decrypts nothing — asserted byte-for-byte by `frontend/tests/crypto/no-leak.test.ts`, which
inspects the actual login request body.

**Residual**: the AuthHash is a credential, so TLS is load-bearing, and TLS is the operator's
responsibility rather than the application's. Recorded as a hard requirement in
[`operations.md`](./operations.md).

### D — Device thief · **Partially mitigated**, and the boundary is sharp

Locked: the offline copy is ciphertext and keys exist only in memory. `offline-cache.test.ts`
walks the whole IndexedDB database and asserts no derived key and no plaintext appears anywhere
in it — chosen over "check the fields we remember" precisely so a field added later is still
covered.

Unlocked and on screen: **everything is readable.** Auto-lock is capped at 15 minutes and is
enforced identically offline.

**Residual, and new in this design**: caching a vault for offline reading is exposure an
online-only product would not have. Mitigated by the 30-day expiry, the discard on sign-out and
on revocation, and a per-device off switch. Judged worth it; a user who disagrees can turn it
off, and turning it off deletes the copy immediately rather than at next sign-in.

### E — Revoked member · **Mitigated server-side, bounded client-side**

Server refusal is immediate and independent of re-encryption — every key wrap the member held is
deleted at every generation, not just the current one
(`backend/tests/security/revocation.test.ts`).

**Residual, and honestly the sharpest edge in the product**: a revoked member's device that
already holds an offline copy keeps reading it until it next reaches the network. Rotation is
what makes the old key permanently useless. **A rotation left incomplete leaves that window
open indefinitely**, which is why a stuck rotation is called out as the highest-signal thing to
monitor in [`operations.md`](./operations.md).

### F — Malicious current member · **Not defensible, by definition**

Someone who can read a vault can copy it. Removal ends future access and cannot un-know what was
seen. No system can do better, and one that implied otherwise would be lying to its users. Stated
as such in [`security-model.md`](./security-model.md).

Bounded where it can be: Viewers are refused writes at the server regardless of what the
interface offered, and every membership change is written to an append-only log that the database
itself refuses to `UPDATE` or `DELETE` — enforced against a **non-owner** role, because a REVOKE
against a table's owner is silently a no-op in PostgreSQL.

### G — Compromised application server · **Not mitigated. The fundamental limit.**

An attacker serving modified client code captures master passwords as they are typed. This is
true of every web-delivered password manager. Partially reduced by the installable, cached
application shell, which is not re-fetched on every use — a reduction in exposure window, not a
defence.

Stated plainly to users rather than buried; it is the one case where the incident runbook tells
operators to advise a master-password change.

---

## 3. Design decisions re-examined under review

Four choices were checked specifically because getting them wrong is quiet rather than loud.

**AuthHash vs StretchedMasterKey.** Two values from the same master password: one is sent, one
never leaves. Confusing them would send the decryption key to the server while every test still
passed and every screen still worked. `keyring.test.ts` asserts they differ and that neither is
derivable from the other; `no-leak.test.ts` asserts what actually leaves the device.

**No MAC key.** An earlier design derived a separate `macKey`. Removed: AES-GCM authenticates
internally, and a second unused key is a second thing to get wrong.

**RSA key wraps are framed differently from AES envelopes.** An RSA-OAEP wrap has no nonce.
Reusing the envelope format would have meant a zero-filled nonce field — indistinguishable, to a
reviewer, from catastrophic nonce reuse. A separate two-byte framing makes the distinction
structural.

**Salts are hashed before use.** Argon2 requires ≥8 bytes of salt, and `a@b.co` is six. Passing
the raw address would have failed for real users only after launch.

---

## 4. Open findings

Carried deliberately, each with a reason.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Custom template names and field labels are stored in plaintext | Medium | Open — documented |
| 2 | A revoked member's offline copy survives until the device reconnects | Medium | Accepted; rotation closes it |
| 3 | Compromised server can serve malicious client code | High | Accepted; inherent to web delivery |
| 4 | Metadata (membership graph, timing, sizes) is visible to the operator | Low | Accepted; documented |
| 5 | Weak master passwords remain guessable offline | Medium | Mitigated by Argon2id + strength gate |

**Finding 1 is the only one that is a bug rather than a boundary.** A user-defined secret type
called "Offshore accounts", with a field labelled "Recovery phrase", tells the operator a great
deal without decrypting anything — and the data model already rejects exactly this reasoning for
field *values*. It is unfixed because the fix is not local: templates are account-scoped while
the keys that could seal them are vault-scoped, so encrypting the metadata under the author's
UserKey would make a shared vault's templates unreadable to the members who need them to render
those very secrets. That trade-off deserves its own decision.

Per-secret custom fields do **not** have this problem: label and value are encrypted together as
one document, so the server learns only that a secret has extra fields.

---

## 5. Verdict

The cryptographic and authentication surface is **fit for release**, with findings 2–5 accepted
as documented boundaries and finding 1 carried as known and disclosed.

Re-review is required before any change that:

- moves cryptography across the client/server line,
- alters the key hierarchy or any wrap format,
- changes what the offline cache stores,
- changes what a backup file contains, or
- weakens revocation or the append-only log.

