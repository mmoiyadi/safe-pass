/**
 * Multi-generation key selection (T096).
 *
 * A vault mid-rotation holds two live generations at once. The rules that keep that safe:
 *
 *  - a READER selects the key by the ROW's generation, never the vault's current one, because
 *    a rotation has not reached every row yet
 *  - a WRITER always uses the highest generation held, so the rotation never chases rows being
 *    written behind it
 *
 * Getting the reader wrong fails on every row the rotation has not reached. Getting the writer
 * wrong means the job never terminates.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  addSymmetricVaultKey,
  heldVersions,
  isUnlocked,
  lock,
  unlock,
  vaultKeyFor,
  writeKeyFor,
} from '../../src/vault/keyring.js';
import { generateUserKey, generateKeypair, wrapUserKey } from '../../src/crypto/user-key.js';
import { generateVaultKey, wrapVaultKeySymmetric } from '../../src/crypto/vault-key.js';
import { decrypt, encrypt } from '../../src/crypto/envelope.js';

const VAULT = 'vault-1';

/** Unlocks a keyring holding the given vault-key generations. */
async function unlockWith(generations: Array<{ version: number; key: Uint8Array }>) {
  const stretched = crypto.getRandomValues(new Uint8Array(32));
  const userKey = generateUserKey();
  const keypair = await generateKeypair(userKey);

  await unlock({
    stretchedMasterKey: stretched,
    wrappedUserKey: await wrapUserKey(stretched, userKey),
    wrappedPrivateKey: keypair.wrappedPrivateKey,
  });

  for (const g of generations) {
    await addSymmetricVaultKey(VAULT, g.version, await wrapVaultKeySymmetric(userKey, g.key));
  }
}

afterEach(() => lock());

describe('a vault at a single generation', () => {
  it('reads and writes at that generation', async () => {
    const key = generateVaultKey();
    await unlockWith([{ version: 1, key }]);

    expect(heldVersions(VAULT)).toEqual([1]);
    expect(writeKeyFor(VAULT).keyVersion).toBe(1);

    const sealed = await encrypt(vaultKeyFor(VAULT, 1), 'hello');
    expect(await decrypt(writeKeyFor(VAULT).key, sealed)).toBe('hello');
  });
});

describe('a vault mid-rotation, holding two generations', () => {
  it('holds both, and they are different keys', async () => {
    const old = generateVaultKey();
    const fresh = generateVaultKey();
    await unlockWith([
      { version: 1, key: old },
      { version: 2, key: fresh },
    ]);

    expect(heldVersions(VAULT)).toEqual([1, 2]);
    expect(Buffer.from(vaultKeyFor(VAULT, 1)).toString('hex')).not.toBe(
      Buffer.from(vaultKeyFor(VAULT, 2)).toString('hex'),
    );
  });

  /** The FR-083 property: every row opens, whichever generation encrypted it. */
  it('opens a row at EITHER generation by selecting on the row', async () => {
    const old = generateVaultKey();
    const fresh = generateVaultKey();
    await unlockWith([
      { version: 1, key: old },
      { version: 2, key: fresh },
    ]);

    const rows = [
      { keyVersion: 1, title: await encrypt(old, 'not yet rewritten') },
      { keyVersion: 2, title: await encrypt(fresh, 'already rewritten') },
    ];

    for (const row of rows) {
      const opened = await decrypt(vaultKeyFor(VAULT, row.keyVersion), row.title);
      expect(opened).toMatch(/rewritten/);
    }
  });

  /**
   * The mistake this guards against: reading by the vault's CURRENT version rather than the
   * row's. It fails on precisely the rows a rotation has not reached — which is most of them,
   * early on.
   */
  it('reading an old row with the new key fails, which is why selection must be per-row', async () => {
    const old = generateVaultKey();
    const fresh = generateVaultKey();
    await unlockWith([
      { version: 1, key: old },
      { version: 2, key: fresh },
    ]);

    const oldRow = await encrypt(old, 'written before the rotation');
    await expect(decrypt(vaultKeyFor(VAULT, 2), oldRow)).rejects.toThrow();
  });

  it('a writer always uses the HIGHEST generation, so the job never chases it', async () => {
    const old = generateVaultKey();
    const fresh = generateVaultKey();
    await unlockWith([
      { version: 1, key: old },
      { version: 2, key: fresh },
    ]);

    const { key, keyVersion } = writeKeyFor(VAULT);
    expect(keyVersion).toBe(2);

    // The value it produces opens with generation 2 and not with generation 1.
    const written = await encrypt(key, 'written during the rotation');
    expect(await decrypt(vaultKeyFor(VAULT, 2), written)).toBe('written during the rotation');
    await expect(decrypt(vaultKeyFor(VAULT, 1), written)).rejects.toThrow();
  });

  it('does not care what order the generations arrived in', async () => {
    const old = generateVaultKey();
    const fresh = generateVaultKey();
    await unlockWith([
      { version: 2, key: fresh },
      { version: 1, key: old },
    ]);
    expect(writeKeyFor(VAULT).keyVersion).toBe(2);
    expect(heldVersions(VAULT)).toEqual([1, 2]);
  });
});

describe('a generation that is not held', () => {
  it('refuses loudly rather than returning a wrong key', async () => {
    await unlockWith([{ version: 1, key: generateVaultKey() }]);
    expect(() => vaultKeyFor(VAULT, 2)).toThrow(/generation 2/);
  });

  it('refuses for a vault held at no generation at all', async () => {
    await unlockWith([{ version: 1, key: generateVaultKey() }]);
    expect(() => vaultKeyFor('some-other-vault', 1)).toThrow();
    expect(() => writeKeyFor('some-other-vault')).toThrow();
  });
});

describe('locking', () => {
  it('discards every generation, so nothing is readable afterwards', async () => {
    await unlockWith([
      { version: 1, key: generateVaultKey() },
      { version: 2, key: generateVaultKey() },
    ]);
    expect(isUnlocked()).toBe(true);

    lock();

    expect(isUnlocked()).toBe(false);
    expect(heldVersions(VAULT)).toEqual([]);
    expect(() => vaultKeyFor(VAULT, 1)).toThrow(/locked/);
    expect(() => writeKeyFor(VAULT)).toThrow(/locked/);
  });
});
