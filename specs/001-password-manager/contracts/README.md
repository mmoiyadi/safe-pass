# API Contracts

**Date**: 2026-08-26 | **Plan**: [../plan.md](../plan.md)

| File | What it defines |
|------|-----------------|
| [crypto-envelope.md](./crypto-envelope.md) | The client-side crypto contract and key hierarchy — **read this first** |
| [openapi.yaml](./openapi.yaml) | REST API surface: paths, payloads, status codes |

## Conventions

**Base path**: `/api/v1`. **Transport**: HTTPS only; plaintext HTTP is refused, not redirected.

**Authentication**: opaque session token in an `HttpOnly; Secure; SameSite=Strict` cookie. The token
is a random 256-bit value; the server stores only its SHA-256 digest. Unauthenticated requests to
protected routes get `401`.

**Ciphertext fields**: every field documented as `format: envelope` is a base64url `Envelope` per the
crypto contract. The server validates only that it parses as an envelope of a known version — it
never inspects the contents.

**Concurrency**: mutating a `Secret` requires the `revision` it was read at. A mismatch returns `409`
with the current row attached.

## Error model

```json
{ "error": { "code": "VAULT_FORBIDDEN", "message": "…", "details": {} } }
```

| Status | Codes | Notes |
|--------|-------|-------|
| 400 | `VALIDATION_FAILED`, `ENVELOPE_MALFORMED` | |
| 401 | `AUTH_REQUIRED`, `AUTH_FAILED`, `TOTP_REQUIRED`, `TOTP_INVALID`, `REAUTH_REQUIRED` | `AUTH_FAILED` is returned identically for unknown account and wrong password (FR-003). `REAUTH_REQUIRED` is described below |
| 403 | `VAULT_FORBIDDEN`, `ROLE_INSUFFICIENT`, `OFFLINE_WRITE_REFUSED` | |
| 404 | `NOT_FOUND` | Also returned for resources the caller may not access, so membership is not enumerable (FR-027) |
| 409 | `REVISION_CONFLICT`, `KEY_VERSION_STALE`, `LAST_OWNER`, `ROTATION_IN_PROGRESS`, `INVITATION_EXISTS`, `INVITATION_NOT_READY` | |
| 422 | `TEMPLATE_FIELD_DUPLICATE`, `TEMPLATE_FIELD_IN_USE` | |
| 429 | `RATE_LIMITED` | Login, unlock, TOTP, invitation |

**Timing uniformity**: `401 AUTH_FAILED` responses are padded to a constant floor so response time
does not distinguish a missing account from a wrong password. Timing is asserted in
`tests/security/`, not assumed.

### `REAUTH_REQUIRED` (FR-072 to FR-074)

A master password change stamps `reauthRequiredAt` on every *other* session belonging to that user.
Those sessions stay established, but the session guard returns `401 REAUTH_REQUIRED` for **every**
route except `POST /auth/reauth` until the session presents an AuthHash derived from the new
password. Re-auth clears the flag, returns the rewrapped keyring, and does not re-challenge the
second factor.

The enforcement point matters. A client that has already unwrapped the UserKey holds it in memory and
can keep decrypting whatever it has; a client-side "please re-enter your password" prompt is
advisory and a hostile client ignores it. Putting the refusal in the session guard removes the
client's vote. `tests/security/` asserts that a stamped session is refused on a data route, not
merely that the UI prompts.

## Authorization model

Every route touching vault data resolves `VaultMembership(vaultId, callerId, status='active')`
**before** loading data, then checks the role:

| Action | Owner | Editor | Viewer |
|--------|:-----:|:------:|:------:|
| Read secrets | ✅ | ✅ | ✅ |
| Create / edit / delete secrets | ✅ | ✅ | ❌ |
| Manage folders and tags | ✅ | ✅ | ❌ |
| Invite, revoke, change roles | ✅ | ❌ | ❌ |
| Complete or withdraw a pending invitation | ✅ | ❌ | ❌ |
| Run or resume a key rotation | ✅ | ❌ | ❌ |
| Export vault | ✅ | ❌ | ❌ |
| Delete vault | ✅ | ❌ | ❌ |

A Viewer's write attempt returns `403 ROLE_INSUFFICIENT` at the server regardless of what the UI
offered (FR-033, SC-012).

## Three honest limitations of the API design

**1. TOTP cannot gate the API the way it does in a non-zero-knowledge product.** The TOTP seed is
sealed under the UserKey, so the server cannot verify a code by itself. The flow is: password
authentication succeeds → server issues a *pending* session that can fetch the wrapped TOTP seed and
nothing else → client unwraps the seed, computes and verifies the code locally, and presents the
result → server upgrades the session. This means a client that is fully compromised can skip the
check. Second factor here raises the cost of a *stolen password*, which is the realistic threat; it is
not a defense against a compromised device. Storing the seed server-side in plaintext would make
verification authoritative — and would hand the operator a credential it is not supposed to hold.

**2. Revocation is server-authoritative but not instantaneous on offline devices.** `DELETE
/vaults/{id}/members/{userId}` removes access immediately and opens a key rotation, but a revoked
member's device holding an offline cache retains readable ciphertext until it next reaches the
network and discards the cache (FR-058). SC-005's 60-second bound is a statement about server-side
access. This is inherent to offline reads and is documented rather than obscured.

**3. Completing an invitation requires an Owner's device, so the API cannot make sharing immediate.**
The server cannot wrap a VaultKey — it has no key. When the invitee had no account at invite time,
`POST /vaults/{id}/invitations/{invId}/complete` can only be called by an Owner whose device holds
the unwrapped VaultKey, after the invitee registers. Between those two events the API has an
invitation that is *ready* and grants nothing. Every alternative that removes the delay requires the
server to hold openable key material, which Principle I forbids (research.md §12). The API surfaces
the pending state honestly rather than implying access was granted.
