/**
 * Payload encryption. AES-256-GCM via WebCrypto, framed per contracts/crypto-envelope.md.
 *
 * Invariants enforced here:
 *  - a fresh crypto.getRandomValues(12) nonce per encryption; never derived, reused, or incremented
 *  - a GCM authentication failure surfaces as an error and is never retried, ignored, or
 *    best-effort decrypted (FR-018)
 */
import {
  type Envelope,
  NONCE_BYTES,
  frameEnvelope,
  unframeEnvelope,
} from '@pm/shared';

async function importAesKey(raw: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('AES-256-GCM requires a 32-byte key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}

/** Raw primitive, exposed so NIST CAVP vectors can be asserted directly. Returns ct‖tag. */
export async function aesGcmEncryptRaw(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const k = await importAesKey(key, 'encrypt');
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, k, plaintext);
  return new Uint8Array(out);
}

export async function aesGcmDecryptRaw(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertextWithTag: Uint8Array,
): Promise<Uint8Array> {
  const k = await importAesKey(key, 'decrypt');
  const out = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    k,
    ciphertextWithTag,
  );
  return new Uint8Array(out);
}

/** Encrypt bytes into an envelope. */
export async function encryptBytes<T>(key: Uint8Array, plaintext: Uint8Array): Promise<Envelope<T>> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertextWithTag = await aesGcmEncryptRaw(key, nonce, plaintext);
  return frameEnvelope(nonce, ciphertextWithTag) as Envelope<T>;
}

export async function decryptBytes<T>(key: Uint8Array, envelope: Envelope<T>): Promise<Uint8Array> {
  const { nonce, ciphertextWithTag } = unframeEnvelope(envelope);
  // A failure here is a corrupt or tampered record. It propagates; there is no fallback path.
  return aesGcmDecryptRaw(key, nonce, ciphertextWithTag);
}

/** Encrypt a UTF-8 string. The common case for titles, names, and field values. */
export async function encrypt<T>(key: Uint8Array, plaintext: string): Promise<Envelope<T>> {
  return encryptBytes<T>(key, new TextEncoder().encode(plaintext));
}

export async function decrypt<T>(key: Uint8Array, envelope: Envelope<T>): Promise<string> {
  return new TextDecoder().decode(await decryptBytes(key, envelope));
}
