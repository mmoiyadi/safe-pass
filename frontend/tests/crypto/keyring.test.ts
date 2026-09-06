/**
 * Key-hierarchy tests (Principle IV).
 *
 * These assert the property the entire product rests on: the value sent to the server to prove
 * identity is computationally useless for decryption, and holding one derived value yields
 * nothing about the other.
 */
import { describe, expect, it } from 'vitest';
import { deriveAuthHash, deriveMasterKey } from '../../src/crypto/kdf.js';
import { deriveStretchedMasterKey } from '../../src/crypto/master-key.js';
import { generateUserKey, unwrapUserKey, wrapUserKey } from '../../src/crypto/user-key.js';
import { generateVaultKey, unwrapVaultKeySymmetric, wrapVaultKeySymmetric } from '../../src/crypto/vault-key.js';
import { decrypt, encrypt } from '../../src/crypto/envelope.js';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('AuthHash and StretchedMasterKey are separate', () => {
  it('are different values', async () => {
    const mk = await deriveMasterKey('pw', 'alice@example.com');
    expect(hex(await deriveAuthHash(mk, 'pw'))).not.toBe(hex(await deriveStretchedMasterKey(mk)));
  });

  /**
   * The failure this guards against: an implementation that sends the StretchedMasterKey to
   * the server as if it were the AuthHash. Both are 32 opaque bytes, so nothing but this
   * assertion would notice.
   */
  it('the AuthHash cannot open data encrypted under the StretchedMasterKey', async () => {
    const mk = await deriveMasterKey('pw', 'alice@example.com');
    const smk = await deriveStretchedMasterKey(mk);
    const authHash = await deriveAuthHash(mk, 'pw');

    const sealed = await encrypt(smk, 'the user key');
    await expect(decrypt(authHash, sealed)).rejects.toThrow();
  });
});

describe('password change is O(1) (FR-005)', () => {
  it('rewraps the UserKey and leaves every vault key and secret untouched', async () => {
    const userKey = generateUserKey();
    const vaultKey = generateVaultKey();

    const oldSmk = await deriveStretchedMasterKey(await deriveMasterKey('old-pw', 'a@b.co'));
    const newSmk = await deriveStretchedMasterKey(await deriveMasterKey('new-pw', 'a@b.co'));

    const wrappedVaultKey = await wrapVaultKeySymmetric(userKey, vaultKey);
    const secret = await encrypt(vaultKey, 'hunter2');

    // The whole password change: one rewrap.
    const rewrapped = await wrapUserKey(newSmk, await unwrapUserKey(oldSmk, await wrapUserKey(oldSmk, userKey)));

    const recoveredUserKey = await unwrapUserKey(newSmk, rewrapped);
    expect(hex(recoveredUserKey)).toBe(hex(userKey));

    // Untouched: the vault key wrap and the secret ciphertext are byte-identical.
    expect(hex(await unwrapVaultKeySymmetric(recoveredUserKey, wrappedVaultKey))).toBe(hex(vaultKey));
    expect(await decrypt(vaultKey, secret)).toBe('hunter2');
  });

  it('the old password stops opening the keyring', async () => {
    const userKey = generateUserKey();
    const oldSmk = await deriveStretchedMasterKey(await deriveMasterKey('old-pw', 'a@b.co'));
    const newSmk = await deriveStretchedMasterKey(await deriveMasterKey('new-pw', 'a@b.co'));

    const rewrapped = await wrapUserKey(newSmk, userKey);
    await expect(unwrapUserKey(oldSmk, rewrapped)).rejects.toThrow();
  });
});

describe('vault isolation (FR-024)', () => {
  it('one vault key cannot open another vault', async () => {
    const a = generateVaultKey();
    const b = generateVaultKey();
    await expect(decrypt(b, await encrypt(a, 'vault a secret'))).rejects.toThrow();
  });
});
