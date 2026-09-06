/**
 * VaultKey — one per vault per generation.
 *
 * A vault mid-rotation holds TWO live generations, and every remaining member holds a wrap for
 * both. Readers select the key by each ROW's keyVersion; writers always use the highest
 * generation they hold. See research.md §11.
 */
import type { Envelope, WrappedKey } from '@pm/shared';
import { ALG_RSA_OAEP, frameKeyWrap, unframeKeyWrap } from '@pm/shared';
import { decryptBytes, encryptBytes } from './envelope.js';

export function generateVaultKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Personal vaults: wrapped under the owner's UserKey. */
export async function wrapVaultKeySymmetric(
  userKey: Uint8Array,
  vaultKey: Uint8Array,
): Promise<Envelope<WrappedKey>> {
  return encryptBytes<WrappedKey>(userKey, vaultKey);
}

export async function unwrapVaultKeySymmetric(
  userKey: Uint8Array,
  wrapped: Envelope<WrappedKey>,
): Promise<Uint8Array> {
  return decryptBytes(userKey, wrapped);
}

/**
 * Shared vaults: wrapped to a member's RSA public key.
 *
 * This is the operation the server cannot perform — it has no key — which is why completing an
 * invitation requires an Owner's device to be online (FR-068).
 */
export async function wrapVaultKeyForMember(
  memberPublicKey: CryptoKey,
  vaultKey: Uint8Array,
): Promise<Envelope<WrappedKey>> {
  const sealed = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, memberPublicKey, vaultKey);
  // Framed with the same version/algorithm header an AES wrap carries, so the server can
  // validate every key wrap the same way without being able to open any of them.
  return frameKeyWrap(ALG_RSA_OAEP, new Uint8Array(sealed)) as Envelope<WrappedKey>;
}

export async function unwrapVaultKeyForMember(
  privateKey: CryptoKey,
  wrapped: Envelope<WrappedKey>,
): Promise<Uint8Array> {
  const { algorithm, payload } = unframeKeyWrap(wrapped);
  if (algorithm !== ALG_RSA_OAEP) {
    throw new Error(`Expected an RSA-OAEP key wrap, got algorithm ${algorithm}`);
  }
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, payload);
  return new Uint8Array(raw);
}

/**
 * Selects the key for a row by ITS generation, not the vault's current one.
 * Reading by the vault's version would fail on every row a running rotation has not reached.
 */
export function keyForVersion(
  keysByVersion: ReadonlyMap<number, Uint8Array>,
  rowKeyVersion: number,
): Uint8Array {
  const key = keysByVersion.get(rowKeyVersion);
  if (!key) throw new Error(`No vault key held for generation ${rowKeyVersion}`);
  return key;
}

/** Writers always use the highest generation held, so a rotation never chases its own tail. */
export function highestVersion(keysByVersion: ReadonlyMap<number, Uint8Array>): number {
  const versions = [...keysByVersion.keys()];
  if (versions.length === 0) throw new Error('No vault keys held');
  return Math.max(...versions);
}
