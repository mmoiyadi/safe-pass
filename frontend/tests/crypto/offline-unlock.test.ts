/**
 * Opening the cached vault offline (FR-054, FR-056).
 *
 * The property that matters: being offline must not weaken the check. The cache holds wrapped
 * keys and nothing that could verify a password by itself, so a wrong password fails in the
 * unwrap — the same operation that would fail online — and no secret becomes readable.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveMasterKey } from '../../src/crypto/kdf.js';
import { deriveStretchedMasterKey } from '../../src/crypto/master-key.js';
import { generateKeypair, generateUserKey, wrapUserKey } from '../../src/crypto/user-key.js';
import { generateVaultKey, wrapVaultKeySymmetric } from '../../src/crypto/vault-key.js';
import { encrypt } from '../../src/crypto/envelope.js';
import { discardAll, saveSnapshot, setOfflineEnabled } from '../../src/vault/offline-cache.js';
import { unlockOffline } from '../../src/vault/offline-session.js';
import { isUnlocked, lock, vaultKeyFor } from '../../src/vault/keyring.js';

const EMAIL = 'offline-unlock@example.test';
const PASSWORD = 'correct horse battery staple';

let vaultKey: Uint8Array;

async function seedCache(): Promise<void> {
  const stretched = await deriveStretchedMasterKey(await deriveMasterKey(PASSWORD, EMAIL));
  const userKey = generateUserKey();
  const keypair = await generateKeypair(userKey);
  vaultKey = generateVaultKey();

  await saveSnapshot({
    email: EMAIL,
    refreshedAt: Date.now(),
    keyring: {
      wrappedUserKey: await wrapUserKey(stretched, userKey),
      wrappedPrivateKey: keypair.wrappedPrivateKey,
      publicKey: keypair.publicKey,
    },
    vaults: [
      {
        id: 'vault-1',
        kind: 'personal',
        name: await encrypt(vaultKey, 'Personal'),
        keyVersion: 1,
        nameKeyVersion: 1,
        role: 'owner',
        keyWraps: [{ keyVersion: 1, wrappedVaultKey: await wrapVaultKeySymmetric(userKey, vaultKey) }],
        secrets: [],
        folders: [],
        tags: [],
        templates: [],
      },
    ],
  });
}

beforeEach(async () => {
  lock();
  await discardAll();
  await setOfflineEnabled(true);
  await seedCache();
});

describe('offline unlock', () => {
  it('opens the cached vault with the right master password', async () => {
    const result = await unlockOffline(EMAIL, PASSWORD);
    expect(result).not.toBeNull();
    expect(isUnlocked()).toBe(true);
    expect(result!.vaults).toHaveLength(1);
  });

  it('holds the vault key, so cached ciphertext actually decrypts', async () => {
    await unlockOffline(EMAIL, PASSWORD);
    expect(vaultKeyFor('vault-1', 1)).toEqual(vaultKey);
  });

  /** The check is not softened because the server is unreachable. */
  it('refuses a wrong master password', async () => {
    await expect(unlockOffline(EMAIL, 'not the right password')).rejects.toThrow();
    expect(isUnlocked()).toBe(false);
  });

  it('leaves nothing unlocked after a failed attempt', async () => {
    await unlockOffline(EMAIL, 'wrong').catch(() => {});
    expect(() => vaultKeyFor('vault-1', 1)).toThrow();
  });

  it('returns null for an account with no cached copy, rather than failing obscurely', async () => {
    expect(await unlockOffline('nobody@example.test', PASSWORD)).toBeNull();
  });

  it('returns null when the user has turned offline access off', async () => {
    await setOfflineEnabled(false);
    expect(await unlockOffline(EMAIL, PASSWORD)).toBeNull();
  });
});
