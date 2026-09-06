# Contract: Ciphertext Envelope and Key Hierarchy

**Date**: 2026-08-26 | **Plan**: [../plan.md](../plan.md)

This is the load-bearing contract of the system. The REST API can be re-specified freely; **this one
cannot change without a migration of every stored record**, and violating it silently breaks the
guarantee the whole product rests on.

## The rule

> Any value the user would consider secret is encrypted on the client, before it is serialized into
> a request body, and is transmitted only as an `Envelope`. The server treats every `Envelope` as an
> opaque byte string. There is no server-side code path that can produce a plaintext secret value.

## Envelope format

```text
byte 0        : version   (0x01)
byte 1        : algorithm (0x01 = AES-256-GCM)
bytes 2..13   : nonce     (96-bit, cryptographically random, unique per encryption)
bytes 14..n-17: ciphertext
bytes n-16..n : GCM authentication tag (128-bit)
```

Serialized over the wire as base64url in JSON, as `bytea` in PostgreSQL, as `ArrayBuffer` in
IndexedDB. TypeScript type (`shared/src/envelope.ts`):

```ts
/** Opaque ciphertext. Never log, never inspect, never construct outside frontend/src/crypto. */
export type Envelope<T> = string & { readonly __envelope: unique symbol; readonly __plain?: T };
```

The phantom type parameter means `Envelope<SecretFieldValue>` and `Envelope<VaultName>` are not
interchangeable, and the branded string means a raw `string` cannot be passed where an envelope is
expected. Backend code can move an `Envelope<T>` around but has no function that opens one.

## Key hierarchy contract

| Key | Derivation / origin | Wrapped by | Stored where |
|-----|--------------------|------------|--------------|
| `MasterKey` | `Argon2id(masterPassword, salt = SHA-256("pm:v1:mksalt:" ‖ normalize(email)), m=64MiB, t=3, p=1)` → 32B | — | **Never stored.** Memory only |
| `StretchedMasterKey` | `HKDF-SHA256-Expand(MasterKey, info="pm:v1:stretch", 32B)` → `encKey` | — | **Never stored.** Memory only |
| `AuthHash` | `Argon2id(MasterKey, salt = SHA-256("pm:v1:authsalt:" ‖ masterPassword), t=1)` → 32B | — | Sent to server at login; server stores `Argon2id(AuthHash)` |
| `UserKey` | 32 random bytes at registration | `StretchedMasterKey.encKey` | `user_keyring.wrappedUserKey` |
| `UserPrivateKey` | RSA-4096 keypair at registration | `UserKey` | `user_keyring.wrappedPrivateKey` |
| `UserPublicKey` | — | not wrapped (public) | `user_keyring.publicKey`, plaintext |
| `VaultKey` | 32 random bytes per vault, per generation | `UserKey` (personal) or member's `UserPublicKey` via RSA-OAEP (shared) | `vault_key_wrap.wrappedVaultKey`, one row per member **per live generation** |
| Payload keys | — | — | Payloads encrypted directly with `VaultKey` |

### Why the salts are hashed rather than used raw

Argon2 requires a salt of at least 8 bytes. The email address and the master password are both
shorter than that in legal cases — `a@b.co` is 6 bytes — so each is hashed to a fixed 32-byte salt
under its own domain separator. This changes nothing about the derivation's properties: each salt
is still a pure function of its input, so any device can reproduce the key with no server
round-trip before authentication, and the two derivations remain domain-separated from each other.
Discovered by `tests/crypto/keyring.test.ts` during implementation, not by inspection.

### Why there is no separate `macKey`

An earlier draft expanded the StretchedMasterKey to 64 bytes as `encKey ‖ macKey`. That split belongs
to constructions built on AES-CBC + HMAC, where a distinct MAC key is required for integrity. Every
payload here is AES-256-GCM, which authenticates as part of the AEAD, so `macKey` had no consumer.
It was removed on 2026-09-01: key material with no defined purpose is an invitation for a later
contributor to press it into service, and the likeliest such use — reusing it as a second encryption
key — breaks key separation. HKDF now expands to exactly the 32 bytes that are used.

### Why `AuthHash` is derived from `MasterKey` and not from the password

The server must verify the user knows the master password without ever holding anything that decrypts
their data. `AuthHash` is a one-way function of `MasterKey` — it proves knowledge, and it is
computationally useless for decryption. It is not interchangeable with `StretchedMasterKey`: the two
are separate HKDF/Argon2id outputs with different inputs, so possession of one does not yield the
other. **Sending `StretchedMasterKey` to the server instead would be a total compromise of the
design** — this is the single mistake most likely to be made during implementation, and the reason
`tests/security/` asserts on the exact bytes leaving the client at login.

## Vault key generations

A vault undergoing rotation has **two live generations**. The rules that keep this safe:

1. Every ciphertext's owning row carries the `keyVersion` that produced it. **Readers select the key
   by the row's version**, never by the vault's current version.
2. **Writers always encrypt with the vault's highest generation** they hold a wrap for, so a rotation
   never chases rows being written behind it.
3. A generation's key may be destroyed, and its `vault_key_wrap` rows deleted, **only when no row
   references that version**. This is the invariant that prevents a partial rotation from stranding
   data (FR-083).
4. Revoking a member deletes their wraps at **every** generation in the same transaction as the
   status change — never only the current one (FR-080).
5. Two generations is the maximum: a second rotation may not open while one is running.

## Required client-side invariants

1. **Nonce uniqueness**: a fresh `crypto.getRandomValues(12)` per encryption. Never derive, never
   reuse, never increment.
2. **No key persistence**: `MasterKey`, `StretchedMasterKey`, `UserKey`, `UserPrivateKey`, and every
   `VaultKey` exist only in module-scoped memory, held as non-extractable `CryptoKey` wherever the
   algorithm allows. They are never written to `localStorage`, `sessionStorage`, IndexedDB, cookies,
   or any server request.
3. **Cleared on lock**: lock, sign-out, auto-lock, and tab teardown all clear the keyring.
4. **Tamper is a failure, not a fallback**: a GCM authentication failure surfaces as a corrupt-record
   error to the user. It is never retried, never ignored, and never falls back to a "best effort"
   decrypt (FR-015).
5. **Encrypt-then-transmit**: no code path may place a plaintext secret value into a request body.
   Enforced by the `Envelope<T>` type and asserted by a test that inspects captured request payloads.
6. **No key material in an invitation**: an invitation to an address without an account carries no
   wrapped key, no temporary key, and no key-derivation input — in the row, in the email, or in any
   link. A VaultKey is wrapped only to a real `UserPublicKey` belonging to a registered account
   (FR-067). There is no correct wrap for a keypair that does not exist yet.

## What is deliberately NOT encrypted

Stated explicitly so it is a decision on record rather than an oversight:

- Email address — needed to route mail and to salt the KDF
- User public key — needed by others to share with this user
- Timestamps, `revision`, `keyVersion`, IDs, and foreign keys — needed to authorize, order, and sync
- Template **structure** (field labels, types, flags) — needed to render a form before any secret is
  loaded. Note this means a custom template named "Swiss Bank Login" leaks that label; users should be
  told template names are not encrypted
- Role and membership graph — needed for server-side authorization (Principle II)
- Ciphertext length — an inherent metadata leak of any encryption scheme

## Version and migration policy

`version` byte 0x01 is the only currently valid value. Introducing 0x02 (for example, moving to
XChaCha20-Poly1305 or X25519 wrapping) requires: readers accept both versions; a background rewrite
migrates existing records; writers switch only after the rewrite completes. **Decryption support for
a retired version is never removed while any record may still carry it** — an exported backup taken
years earlier must still open.
