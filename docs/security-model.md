# What this service can and cannot see

This document is for the people whose secrets are in the vault. It states plainly what the
people running this service are able to see, what they are not, and where the limits are.

There is a longer, more technical version of the same story in
[`specs/001-password-manager/data-model.md`](../specs/001-password-manager/data-model.md) and
[`threat-model.md`](./threat-model.md). This one is the summary, and it is written to be checked
rather than believed: every claim below names the test that enforces it.

---

## The short version

Your secrets are encrypted on your device, with a key derived from your master password. That
password never leaves your device — not when you sign in, not ever. The server stores ciphertext
it has no key for.

The direct consequence: **if you forget your master password, your vault is gone.** Nobody can
recover it. That is not a policy we could choose to relax; there is nothing on our side to
recover it from.

---

## What we cannot see

| | Why not |
|---|---|
| Your master password | It never leaves your device. What is sent is a separate value derived from it that proves who you are but decrypts nothing. |
| Any secret value | Encrypted with AES-256-GCM under a key we do not have. |
| Secret titles | Same. This is why search runs on your device, not ours. |
| Folder and tag names | Same. |
| Vault names | Same. |
| Your one-time-code seeds | Sealed under your key. We check that a code is not reused; we cannot generate one. |
| Custom fields you add to a single secret | Label *and* value are encrypted together, so we do not even learn what you called the field. |
| Anything in a backup file | A backup is your ciphertext plus your wrapped keys. |

Enforced by `backend/tests/security/no-plaintext.test.ts`, which dumps the entire database after
seeding a vault and asserts each known value appears **zero** times.

## What we can see

This is the part worth reading carefully, because a "zero-knowledge" claim can be used to imply
more than it delivers.

- **Your email address.** It identifies your account and is used as an input to the key
  derivation. It is also how another person addresses an invitation to you.
- **When you sign in, from roughly where, and on what kind of device.** Kept 90 days, and shown
  to you under Settings. Locations are deliberately coarse — enough to notice something
  unfamiliar, not a record of where you have been.
- **Which vaults exist, who belongs to them, and in what role.** The membership graph is
  metadata we cannot encrypt without breaking the sharing that depends on it.
- **How many secrets, folders, and tags a vault holds, and when each was last changed.** Sizes
  and timestamps are visible even though contents are not.
- **What happened to a shared vault**: who invited whom, who accepted, who was removed, when a
  key rotation ran, when an export was taken. This exists so the other members can see it too.
- **The names and field labels of any custom secret type you define.** See "Known limitations".

You can download everything in this list for yourself: **Settings → Personal data export**.

## What a stolen database would yield

Everything in "What we can see", and nothing from "What we cannot see". An attacker holding a
complete copy of our database — and of our backups — still needs your master password, and the
only way to test a guess is to run Argon2id at 64 MiB per attempt, which makes large-scale
guessing expensive rather than merely discouraged.

## What a stolen device would yield

If the vault is locked: the same as a stolen database. The offline copy on the device is
ciphertext, and your keys are held only in memory and only while unlocked.

If the vault is unlocked and on screen: everything in it. No amount of cryptography helps here.
This is why auto-lock exists and why it cannot be set higher than 15 minutes.

---

## Where the limits are

These are the honest edges. None of them is hidden in a footnote elsewhere.

**A forgotten master password is unrecoverable.** There is no reset link, no support override,
no escrowed copy. Deleting the account and starting over is the only remaining action.

**We cannot verify what your browser runs.** Everything above depends on the code your device
executes. We serve that code, so someone who compromised our servers could serve different code
to a targeted user and capture a master password as it is typed. This is the fundamental limit
of any web-delivered password manager, ours included. It is why the application is installable
and cached: an installed copy is not re-fetched on every use.

**A revoked member's device keeps its offline copy until it reconnects.** Server-side refusal is
immediate. A device already holding an encrypted copy can keep reading it until it next reaches
the network, at which point the copy is discarded. Rotating the vault key is what makes the
old copy permanently useless, and that is offered whenever someone is removed.

**A member you shared with could always copy what they could read.** Removing them stops future
access. It cannot un-know what they have already seen — no system can, and one that implied
otherwise would be lying.

**Custom secret-type names are stored in the clear.** If you define your own secret type, its
name and its field labels are readable by us; the values stored in those fields are not. Fields
you add to a *single* secret do not have this problem. See
[`data-model.md`](../specs/001-password-manager/data-model.md) for why this is not yet fixed.

**Metadata is not nothing.** Knowing that you hold 340 secrets, that you added four last
Tuesday, and that you share a vault with two named people is real information, even without a
single decrypted value.

---

## How to check any of this yourself

Everything above is enforced by tests in this repository rather than by assurance:

```
backend/tests/security/no-plaintext.test.ts     the database holds no plaintext (SC-004)
frontend/tests/crypto/no-leak.test.ts           the login request carries no password or key
frontend/tests/crypto/offline-cache.test.ts     the device copy holds no key material
backend/tests/security/export.test.ts           a backup opens only with the master password
backend/tests/security/revocation.test.ts       removal takes effect at once, server-side
```

Run them with `pnpm -r test`.
