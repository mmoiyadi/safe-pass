/**
 * UserKey and the RSA keypair.
 *
 * The UserKey is why a password change is O(1): the StretchedMasterKey wraps THIS key, not the
 * secrets, so changing the password rewraps one value and leaves every secret's ciphertext
 * untouched (FR-005).
 *
 * The RSA keypair is why sharing works without disclosing a password: a VaultKey can be wrapped
 * to someone's public key, which is freely readable, and only their private key opens it (FR-023).
 */
import type { Envelope, WrappedKey } from '@pm/shared';
import { bytesToBase64Url, base64UrlToBytes } from '@pm/shared';
import { decryptBytes, encryptBytes } from './envelope.js';

/** RSA-4096 over X25519: uneven Safari WebCrypto support for X25519 in the target matrix. */
const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

export function generateUserKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function wrapUserKey(
  stretchedMasterKey: Uint8Array,
  userKey: Uint8Array,
): Promise<Envelope<WrappedKey>> {
  return encryptBytes<WrappedKey>(stretchedMasterKey, userKey);
}

export async function unwrapUserKey(
  stretchedMasterKey: Uint8Array,
  wrapped: Envelope<WrappedKey>,
): Promise<Uint8Array> {
  return decryptBytes(stretchedMasterKey, wrapped);
}

export interface GeneratedKeypair {
  /** SPKI, base64url. Plaintext by design — others need it to share with this user. */
  publicKey: string;
  /** PKCS#8 sealed under the UserKey. */
  wrappedPrivateKey: Envelope<WrappedKey>;
}

export async function generateKeypair(userKey: Uint8Array): Promise<GeneratedKeypair> {
  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return {
    publicKey: bytesToBase64Url(spki),
    wrappedPrivateKey: await encryptBytes<WrappedKey>(userKey, pkcs8),
  };
}

export async function importPublicKey(spkiBase64Url: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64UrlToBytes(spkiBase64Url), RSA_PARAMS, false, [
    'encrypt',
  ]);
}

export async function unwrapPrivateKey(
  userKey: Uint8Array,
  wrapped: Envelope<WrappedKey>,
): Promise<CryptoKey> {
  const pkcs8 = await decryptBytes(userKey, wrapped);
  return crypto.subtle.importKey('pkcs8', pkcs8, RSA_PARAMS, false, ['decrypt']);
}
