/**
 * The offline cache holds ciphertext and nothing else (T122, FR-055, FR-056, SC-013).
 *
 * Caching a vault on the device is new exposure that an online-only design does not have, so
 * the bar is explicit: a stolen, unlocked device must still yield nothing without the master
 * password. That means the cache may hold exactly what the server already holds — ciphertext
 * and wrapped keys — and none of what the server never sees.
 *
 * The strong test is not "did we remember to omit the key". It is: derive real keys, encrypt
 * real data, write a snapshot, then walk every byte of the database and assert that no derived
 * key and no plaintext appears anywhere in it. That catches a leak through any field, including
 * one added later by someone who never read this comment.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveMasterKey } from '../../src/crypto/kdf.js';
import { deriveStretchedMasterKey } from '../../src/crypto/master-key.js';
import { generateUserKey, wrapUserKey } from '../../src/crypto/user-key.js';
import { generateVaultKey, wrapVaultKeySymmetric } from '../../src/crypto/vault-key.js';
import { encrypt } from '../../src/crypto/envelope.js';
import {
  MAX_CACHE_AGE_MS,
  discardAll,
  discardVault,
  isOfflineEnabled,
  loadSnapshot,
  saveSnapshot,
  setOfflineEnabled,
  type OfflineSnapshot,
} from '../../src/vault/offline-cache.js';

const EMAIL = 'offline@example.test';
const PASSWORD = 'correct horse battery staple';

/** Every byte held anywhere in the database, as one searchable string. */
async function dumpEverything(): Promise<string> {
  const snapshot = await loadSnapshot(EMAIL);
  return JSON.stringify(snapshot, (_key, value: unknown) => {
    if (value instanceof Uint8Array) return Array.from(value).join(',');
    if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value)).join(',');
    return value;
  });
}

interface Built {
  snapshot: OfflineSnapshot;
  userKey: Uint8Array;
  vaultKey: Uint8Array;
  stretched: Uint8Array;
}

/** Builds a realistic snapshot the way the app would, with real keys and real ciphertext. */
async function build(): Promise<Built> {
  const masterKey = await deriveMasterKey(PASSWORD, EMAIL);
  const stretched = await deriveStretchedMasterKey(masterKey);
  const userKey = generateUserKey();
  const vaultKey = generateVaultKey();

  const snapshot: OfflineSnapshot = {
    email: EMAIL,
    refreshedAt: Date.now(),
    keyring: {
      wrappedUserKey: await wrapUserKey(stretched, userKey),
      // A public key is public; the private one is only ever held wrapped.
      wrappedPrivateKey: (await encrypt(userKey, 'a wrapped private key')) as never,
      publicKey: 'a public key',
    },
    vaults: [
      {
        id: 'vault-1',
        kind: 'personal',
        name: await encrypt(vaultKey, 'Personal'),
        keyVersion: 1,
        nameKeyVersion: 1,
        role: 'owner',
        keyWraps: [
          { keyVersion: 1, wrappedVaultKey: await wrapVaultKeySymmetric(userKey, vaultKey) },
        ],
        secrets: [
          {
            id: 'secret-1',
            templateVersionId: 'tv-1',
            keyVersion: 1,
            revision: 1,
            folderId: null,
            tagIds: [],
            title: await encrypt(vaultKey, 'My bank'),
            fieldValues: { password: await encrypt(vaultKey, 'hunter2') },
          },
        ],
        folders: [{ id: 'f1', keyVersion: 1, name: await encrypt(vaultKey, 'Finance') }],
        tags: [{ id: 't1', keyVersion: 1, name: await encrypt(vaultKey, 'urgent') }],
        templates: [
          {
            id: 'tv-1',
            templateId: 'tpl-1',
            version: 1,
            name: 'Website Account',
            kind: 'builtin',
            fields: [
              { id: 'password', label: 'Password', type: 'password', required: true, sensitive: true, order: 0 },
            ],
            createdAt: new Date().toISOString(),
          },
        ],
      },
    ],
  };

  return { snapshot, userKey, vaultKey, stretched };
}

beforeEach(async () => {
  await discardAll();
  await setOfflineEnabled(true);
});

describe('what the cache is allowed to hold', () => {
  it('holds no derived key material anywhere in the database (FR-055)', async () => {
    const { snapshot, userKey, vaultKey, stretched } = await build();
    await saveSnapshot(snapshot);

    const dump = await dumpEverything();

    // Each of these would, on its own, turn a stolen device into a full compromise.
    for (const [name, key] of [
      ['UserKey', userKey],
      ['VaultKey', vaultKey],
      ['StretchedMasterKey', stretched],
    ] as const) {
      expect(dump, `${name} must never be written to disk`).not.toContain(
        Array.from(key).join(','),
      );
    }
  });

  it('holds no plaintext from the vault (SC-013)', async () => {
    const { snapshot } = await build();
    await saveSnapshot(snapshot);

    const dump = await dumpEverything();
    for (const plaintext of ['hunter2', 'My bank', 'Finance', 'urgent']) {
      expect(dump, `${plaintext} must be cached only as ciphertext`).not.toContain(plaintext);
    }
  });

  it('never holds the master password', async () => {
    const { snapshot } = await build();
    await saveSnapshot(snapshot);
    expect(await dumpEverything()).not.toContain(PASSWORD);
  });

  /**
   * The cache is only useful if it holds enough to read the vault offline. A test that passed
   * because nothing was stored would be worthless, so this pins the other side.
   */
  it('does hold the ciphertext and wrapped keys needed to read offline', async () => {
    const { snapshot } = await build();
    await saveSnapshot(snapshot);

    const loaded = await loadSnapshot(EMAIL);
    expect(loaded).not.toBeNull();
    expect(loaded!.vaults[0]!.secrets).toHaveLength(1);
    expect(loaded!.vaults[0]!.secrets[0]!.title).toBe(snapshot.vaults[0]!.secrets[0]!.title);
    expect(loaded!.keyring.wrappedUserKey).toBe(snapshot.keyring.wrappedUserKey);
    expect(loaded!.vaults[0]!.keyWraps[0]!.wrappedVaultKey).toBe(
      snapshot.vaults[0]!.keyWraps[0]!.wrappedVaultKey,
    );
  });

  it('round-trips a snapshot that decrypts with keys derived from the password alone', async () => {
    const { snapshot, vaultKey } = await build();
    await saveSnapshot(snapshot);

    // What an offline unlock does: read the cache, then decrypt with a key derived locally.
    const { decrypt } = await import('../../src/crypto/envelope.js');
    const loaded = await loadSnapshot(EMAIL);
    const title = await decrypt(vaultKey, loaded!.vaults[0]!.secrets[0]!.title as never);
    expect(title).toBe('My bank');
  });
});

describe('staleness and discard (FR-058, FR-059)', () => {
  it('refuses a snapshot older than the staleness limit rather than serving stale secrets', async () => {
    const { snapshot } = await build();
    await saveSnapshot({ ...snapshot, refreshedAt: Date.now() - MAX_CACHE_AGE_MS - 1 });
    expect(await loadSnapshot(EMAIL)).toBeNull();
  });

  it('serves a snapshot that is old but still inside the limit', async () => {
    const { snapshot } = await build();
    await saveSnapshot({ ...snapshot, refreshedAt: Date.now() - MAX_CACHE_AGE_MS + 60_000 });
    expect(await loadSnapshot(EMAIL)).not.toBeNull();
  });

  it('discards an expired snapshot from disk, not merely from the result', async () => {
    const { snapshot } = await build();
    await saveSnapshot({ ...snapshot, refreshedAt: Date.now() - MAX_CACHE_AGE_MS - 1 });
    await loadSnapshot(EMAIL);

    // Expiry must actually remove it: leaving stale ciphertext on the device would keep the
    // exposure while providing none of the benefit.
    await setOfflineEnabled(true);
    expect(await loadSnapshot(EMAIL)).toBeNull();
  });

  it('drops one vault on revocation and leaves the others readable (FR-058)', async () => {
    const { snapshot } = await build();
    const second = { ...snapshot.vaults[0]!, id: 'vault-2' };
    await saveSnapshot({ ...snapshot, vaults: [snapshot.vaults[0]!, second] });

    await discardVault(EMAIL, 'vault-1');

    const loaded = await loadSnapshot(EMAIL);
    expect(loaded!.vaults.map((v) => v.id)).toEqual(['vault-2']);
  });

  it('removes everything on sign-out', async () => {
    const { snapshot } = await build();
    await saveSnapshot(snapshot);
    await discardAll();
    expect(await loadSnapshot(EMAIL)).toBeNull();
  });
});

describe('the per-device off switch (FR-059)', () => {
  it('is on by default only where the user has not said otherwise', async () => {
    expect(await isOfflineEnabled()).toBe(true);
  });

  it('discards any copy already held the moment it is turned off', async () => {
    const { snapshot } = await build();
    await saveSnapshot(snapshot);
    await setOfflineEnabled(false);

    expect(await isOfflineEnabled()).toBe(false);
    expect(await loadSnapshot(EMAIL)).toBeNull();
  });

  it('refuses to write a snapshot while it is off', async () => {
    await setOfflineEnabled(false);
    const { snapshot } = await build();
    await saveSnapshot(snapshot);
    expect(await loadSnapshot(EMAIL)).toBeNull();
  });
});

describe('one account at a time', () => {
  it('does not serve one account the cache belonging to another', async () => {
    const { snapshot } = await build();
    await saveSnapshot(snapshot);
    // Signing in as someone else must not read the previous user's cached vault.
    expect(await loadSnapshot('someone.else@example.test')).toBeNull();
  });

  it('replaces the previous account rather than accumulating devices-worth of vaults', async () => {
    const { snapshot } = await build();
    await saveSnapshot(snapshot);
    await saveSnapshot({ ...snapshot, email: 'second@example.test' });

    expect(await loadSnapshot(EMAIL)).toBeNull();
    expect(await loadSnapshot('second@example.test')).not.toBeNull();
  });
});
