The cast of keys

  ┌────────────────────┬──────────────────────────────────────────┬──────────────────────┬────────────────────────────────────────────────────────────────────┐
  │        Key         │                What it is                │ Server ever sees it? │                                Job                                 │
  ├────────────────────┼──────────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ Master password    │ What you type                            │ Never                │ The one input everything hangs off                                 │
  ├────────────────────┼──────────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ MasterKey          │ Argon2id(password, salt=email) → 32B     │ Never                │ Root of the tree; immediately split into the two below             │
  ├────────────────────┼──────────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ StretchedMasterKey │ HKDF(MasterKey) → 64B                    │ Never                │ Unwraps the UserKey. This is the one that decrypts                 │
  ├────────────────────┼──────────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ AuthHash           │ Argon2id(MasterKey, salt=password) → 32B │ Yes — sent at login  │ Proves you know the password. Cannot decrypt anything              │
  ├────────────────────┼──────────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ UserKey            │ 32 random bytes, made once               │ Only wrapped         │ Your identity key. Unwraps the private key and personal vault keys │
  ├────────────────────┼──────────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ UserPrivateKey     │ RSA-4096, made once                      │ Only wrapped         │ Opens vault keys other people shared to you                        │
  ├────────────────────┼──────────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ UserPublicKey      │ RSA-4096 pair                            │ Yes — in the clear   │ How others share to you. Public by design                          │
  ├────────────────────┼──────────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────────────────┤
  │ VaultKey           │ 32 random bytes, one per vault           │ Only wrapped         │ Encrypts the actual secrets                                        │
  └────────────────────┴──────────────────────────────────────────┴──────────────────────┴────────────────────────────────────────────────────────────────────┘

  Two words carry all the weight:

  - Wrapped = encrypted with another key. The server stores a locked box. It holds no key that opens it.
  - Derived = computed from the password on your device, every time, never stored anywhere.

  The load-bearing distinction is AuthHash vs. StretchedMasterKey. Both come from the MasterKey; both are 32-byte blobs that look identical. One is safe to hand the server, the other would hand it your entire
  vault. They are separate one-way functions with different inputs, so holding the AuthHash gives you no path back to the StretchedMasterKey. This is the single mistake most likely to be made during
  implementation, which is why the plan puts a test on the literal bytes leaving the browser at login.

  ---

  Registration — building the tree

  Everything here happens in your browser. The server is not involved until the last line.

  you type:  email + "correct horse battery staple"
      │
      ├─ Argon2id(password, salt=email, 64MiB, 3 passes) ──▶ MasterKey (32B)
      │       │
      │       ├─ HKDF ────────────▶ StretchedMasterKey ──▶ encKey ‖ macKey
      │       └─ Argon2id(t=1) ───▶ AuthHash
      │
      ├─ random 32 bytes ─────────▶ UserKey
      ├─ generate RSA-4096 ───────▶ PublicKey + PrivateKey
      └─ random 32 bytes ─────────▶ VaultKey  (your personal vault)

  then wrap everything:
      wrappedUserKey    = AES-GCM(encKey,  UserKey)
      wrappedPrivateKey = AES-GCM(UserKey, PrivateKey)
      wrappedVaultKey   = AES-GCM(UserKey, VaultKey)

  POST to server:  email, AuthHash, wrappedUserKey,
                   PublicKey, wrappedPrivateKey, wrappedVaultKey

  The server stores Argon2id(AuthHash) — it hashes the AuthHash again before storing, so a database thief doesn't even get the value needed to log in.

  Look at what was sent. Six items. Two are public by nature (email, public key). One proves identity but decrypts nothing (AuthHash). Three are locked boxes. The server has just been given a complete account and
  cannot read a single secret in it — and never will be able to, because the key that opens the outermost box was derived on your device and discarded from the request.

  ---

  Login — rebuilding the tree

  1. client ──▶ server:  "KDF params for alice@example.com?"
     server ──▶ client:  { argon2id, m=64MiB, t=3 }
                         ← returned for ANY email, real or not,
                           so this endpoint cannot be used to discover accounts

  2. you type the password
     client derives:  MasterKey ─▶ StretchedMasterKey  (stays)
                                └▶ AuthHash            (leaves)

  3. client ──▶ server:  { email, AuthHash }
     server: Argon2id(AuthHash) == stored?  ──▶ session cookie

  4. server ──▶ client:  wrappedUserKey, wrappedPrivateKey, PublicKey,
                         and one wrappedVaultKey per vault you belong to

  5. client unwraps, in order — each key opening the next:

     encKey      ──AES-GCM-open──▶ UserKey
     UserKey     ──AES-GCM-open──▶ PrivateKey
     UserKey     ──AES-GCM-open──▶ VaultKey        (vaults you own)
     PrivateKey  ──RSA-OAEP-open─▶ VaultKey        (vaults shared to you)

  After step 5 your browser holds the plaintext keys in memory. They are never written to localStorage, IndexedDB, or a cookie, and auto-lock wipes them. The server, meanwhile, ran one hash comparison and shipped
  some blobs. It performed no decryption, because it has no function that can.

  ---

  Reading and writing a secret

  Read:
  server ──▶ { id, revision, keyVersion,
               title: <envelope>, fields: [<envelope>, <envelope>] }
                                │
                       VaultKey ▼ AES-256-GCM decrypt        ← in your browser
                       "GitHub" / "alice" / "hunter2"

  Write: the reverse — encrypt each field with the VaultKey using a fresh random 12-byte nonce every time, then send envelopes. The server checks you're authorized and that your revision is current, then stores
  bytes it cannot interpret.

  Each envelope carries a GCM authentication tag. If the server (or anyone) flips a single bit, decryption fails loudly rather than returning wrong data. Corruption and tampering are indistinguishable to the
  client, and both are treated as errors — never retried, never "best-effort" decrypted.

  ---

  Sharing — where the RSA key earns its place

  You want to share "Household" with Bob. You hold its VaultKey in memory. Bob must end up with the same VaultKey, and neither of you may learn anything about the other's password.

  1. your client ──▶ server: "Bob's public key?"     ← public, no secrecy needed
  2. your client: wrapped = RSA-OAEP(BobPublicKey, VaultKey)
  3. your client ──▶ server: new membership row { vault, bob, wrapped, role }

     the server now stores a copy of the VaultKey it cannot open,
     because only Bob's private key can open it

  4. Bob logs in → gets that row
     Bob: password ─▶ StretchedMasterKey ─▶ UserKey ─▶ PrivateKey ─▶ VaultKey
  5. Bob decrypts the same secrets with the same VaultKey

  The server was the courier and read nothing. No shared password, no out-of-band channel, no coordinating in advance. That is the entire reason the RSA keypair exists.

  Two operations become nearly free as a result:

  - Password change: derive a new StretchedMasterKey, re-wrap the UserKey with it, send the new AuthHash and new wrappedUserKey. Two fields update. The UserKey itself never changed, so every VaultKey and all 5,000
    secrets are untouched.
  - Revocation: delete Bob's membership row, then rotate — new VaultKey, re-encrypt the secrets, re-wrap for remaining members, bump keyVersion. Painful, but scoped to one vault. Your other vaults never notice.

  ---

  What an attacker with a full database dump gets

  ┌─────────────────────────────────────┬─────────────────────────────────────────────┐
  │              Can read               │                 Cannot read                 │
  ├─────────────────────────────────────┼─────────────────────────────────────────────┤
  │ Email addresses                     │ Any secret value, title, folder or tag name │
  ├─────────────────────────────────────┼─────────────────────────────────────────────┤
  │ Public keys                         │ Any master password                         │
  ├─────────────────────────────────────┼─────────────────────────────────────────────┤
  │ Who shares which vault, and roles   │ Any key material in usable form             │
  ├─────────────────────────────────────┼─────────────────────────────────────────────┤
  │ Timestamps, revisions, key versions │ 2FA seeds                                   │
  ├─────────────────────────────────────┼─────────────────────────────────────────────┤
  │ Template field labels               │                                             │
  ├─────────────────────────────────────┼─────────────────────────────────────────────┤
  │ Ciphertext lengths                  │                                             │
  └─────────────────────────────────────┴─────────────────────────────────────────────┘

  The right column is only protected by the fact that the master password never arrived. That is the whole guarantee, and it's why "the server must never receive the StretchedMasterKey" is written into the
  contract as the one rule that cannot be relaxed.