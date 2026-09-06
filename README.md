# Password Manager

A zero-knowledge password manager. Secrets are encrypted in the browser with a key derived from
your master password, so the server stores ciphertext it has no way to read — no escrow key, no
recovery path, no exception.

Built spec-first with [Spec Kit](https://github.com/github/spec-kit): the specification, plan,
research, data model and API contracts in [`specs/001-password-manager/`](specs/001-password-manager/)
came before the code, and the code is traceable back to them.

## Status

**73 of 143 tasks.** Three of seven user stories are complete and working end to end.

| Story | | |
|---|---|---|
| US1 — Secure vault access and secret storage | 36/36 | ✅ |
| US2 — Typed secrets from built-in templates | 9/9 | ✅ |
| US3 — Find and organise secrets | 7/7 | ✅ |
| US4 — Multiple vaults and sharing | 0/29 | — |
| US5 — Two-factor authentication | 0/13 | — |
| US6 — Custom templates | 0/6 | — |
| US7 — PWA, offline and backup | 0/11 | — |

92 tests pass (52 frontend, 40 backend against a real PostgreSQL).

## The design in one diagram

The server never receives the master password, and the value it *does* receive cannot decrypt
anything.

```text
master password
  └─Argon2id(salt = email)──▶ MasterKey                    never stored, never sent
       ├─HKDF──▶ StretchedMasterKey    stays on device — this is what decrypts
       └─Argon2id──▶ AuthHash          sent at login — proves identity, decrypts nothing
                          │
       StretchedMasterKey ─┴─unwraps──▶ UserKey            password change rewraps ONE key
                                          ├─unwraps──▶ VaultKey  ──▶ your secrets
                                          └─unwraps──▶ RSA private key
                                                          └─opens VaultKeys shared to you
```

Each layer earns its place by making one requirement possible:

- **UserKey** — changing your master password rewraps a single key instead of re-encrypting every
  secret, so it stays O(1) however large the vault
- **RSA keypair** — a vault key can be wrapped to someone's *public* key, so sharing never
  discloses a password to anyone, including the server
- **Per-vault VaultKey** — revoking one vault re-keys that vault alone

Full reasoning in [`research.md`](specs/001-password-manager/research.md); the binding rules are in
[`contracts/crypto-envelope.md`](specs/001-password-manager/contracts/crypto-envelope.md).

## Prove it yourself

```sh
pnpm install
pnpm db:reset        # PostgreSQL 17 in Docker, migrations, seed templates
pnpm dev             # API on :3000, web on :5173, mail catcher on :8025
```

Store a secret through the UI with a distinctive password, then look for it:

```sh
docker compose exec -T db pg_dump -U pm pm | grep -c "your-distinctive-password"   # 0
```

Two scripts demonstrate the design without the UI:

```sh
pnpm demo            # walks the key hierarchy, shows what the server receives and cannot read
pnpm db:roundtrip    # encrypt → persist to PostgreSQL → read back → decrypt
```

## What works today

Registration with an enforced no-recovery acknowledgement · master password strength (12+ chars,
zxcvbn ≥ 3) · Argon2id at 64 MiB · auto-lock · master password change with **server-enforced**
re-authentication of other devices · four built-in secret types rendered from template rows ·
masking driven by each field's `sensitive` flag · clipboard copy that clears after 30s ·
permanent deletion with typed confirmation · client-side search over 5,000 secrets at p95 < 100ms ·
encrypted folder and tag names with filter chips.

## Layout

```text
backend/     Fastify + Prisma. Stores opaque ciphertext; has no key and no decryption path.
frontend/    React + Vite PWA. ALL cryptography lives in frontend/src/crypto.
shared/      Types only — the Envelope<T> brand that makes a plaintext leak a compile error.
specs/       Specification, plan, research, data model, API contracts, task list.
scripts/     dev, db-reset, and the two demo scripts above.
```

The crypto boundary is enforced by the toolchain, not by convention: any import of
`frontend/src/crypto` from `backend/**` fails `pnpm lint` with an error naming the principle it
breaks.

## Honest limitations

These are design consequences, documented rather than hidden:

- **A forgotten master password is unrecoverable.** That is the same property that keeps the
  operator from reading your vault.
- **TOTP cannot authoritatively gate the API.** The seed is sealed under your own key, so the
  server cannot verify a code by itself. It raises the cost of a stolen password, not of a
  compromised device.
- **Revocation is not instantaneous on an offline device.** It keeps its cached ciphertext until
  it next reaches the network.
- **Key rotation bounds future exposure, not past.** It cannot un-read what a revoked member
  already saw.
- **Not audited, and not production software.** It is a learning project with real cryptography,
  which is not the same as cryptography anyone has reviewed.

## Licence

MIT
