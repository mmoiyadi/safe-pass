/**
 * Ciphertext envelope — the load-bearing contract of the system.
 * See specs/001-password-manager/contracts/crypto-envelope.md.
 *
 * Wire format (bytes):
 *   0        version   (0x01)
 *   1        algorithm (0x01 = AES-256-GCM)
 *   2..13    nonce     (96-bit, random, unique per encryption)
 *   14..n-17 ciphertext
 *   n-16..n  GCM authentication tag (128-bit)
 */

export const ENVELOPE_VERSION = 0x01;
export const ALG_AES_256_GCM = 0x01;
/** RSA-OAEP, used only to wrap a VaultKey to a member's public key. */
export const ALG_RSA_OAEP = 0x02;

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const HEADER_BYTES = 2 + NONCE_BYTES;
/** Smallest legal envelope: header + tag, with an empty plaintext. */
export const MIN_ENVELOPE_BYTES = HEADER_BYTES + TAG_BYTES;

/**
 * Opaque ciphertext. Never log, never inspect, never construct outside frontend/src/crypto.
 *
 * The brand stops a raw `string` being passed where ciphertext is required, and the phantom
 * `__plain` parameter stops an `Envelope<VaultName>` being used as an `Envelope<SecretFieldValue>`.
 * Backend code can move an `Envelope<T>` around but has no function that opens one.
 */
export type Envelope<T> = string & {
  readonly __envelope: unique symbol;
  readonly __plain?: T;
};

/** Phantom plaintext markers. These are type-level only and never constructed. */
export type SecretFieldValue = { readonly __t: 'SecretFieldValue' };
export type SecretTitle = { readonly __t: 'SecretTitle' };
export type VaultName = { readonly __t: 'VaultName' };
export type FolderName = { readonly __t: 'FolderName' };
export type TagName = { readonly __t: 'TagName' };
export type WrappedKey = { readonly __t: 'WrappedKey' };
export type TotpSeed = { readonly __t: 'TotpSeed' };

/* ------------------------------------------------------------------ *
 * base64url codec — no padding, URL-safe. Used on the wire and in JSON.
 * ------------------------------------------------------------------ */

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ *
 * Structural validation.
 *
 * This is deliberately the ONLY thing the server may do with an envelope:
 * confirm it parses as a known version. It never inspects the ciphertext,
 * and there is no counterpart that opens one.
 * ------------------------------------------------------------------ */

export function isWellFormedEnvelope(value: unknown): value is Envelope<unknown> {
  if (typeof value !== 'string' || value.length === 0) return false;
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(value);
  } catch {
    return false;
  }
  if (bytes.length < MIN_ENVELOPE_BYTES) return false;
  return bytes[0] === ENVELOPE_VERSION && bytes[1] === ALG_AES_256_GCM;
}

/* ------------------------------------------------------------------ *
 * Key wraps.
 *
 * A VaultKey reaches the server wrapped one of two ways: under the owner's UserKey with
 * AES-256-GCM (personal vault), or to a member's RSA public key with RSA-OAEP (shared vault).
 * Both land in the same column, so both carry the same 2-byte header — version and algorithm —
 * and the server validates that header on every one.
 *
 * RSA-OAEP has no nonce, so a key wrap is framed as `version ‖ algorithm ‖ payload` rather than
 * reusing the payload envelope's 12-byte nonce field. Zero-filling a nonce that is never used
 * would look like an AES envelope with a catastrophically reused nonce.
 * ------------------------------------------------------------------ */

export const KEY_WRAP_HEADER_BYTES = 2;

export function frameKeyWrap(algorithm: number, payload: Uint8Array): string {
  const out = new Uint8Array(KEY_WRAP_HEADER_BYTES + payload.length);
  out[0] = ENVELOPE_VERSION;
  out[1] = algorithm;
  out.set(payload, KEY_WRAP_HEADER_BYTES);
  return bytesToBase64Url(out);
}

export function unframeKeyWrap(value: string): { algorithm: number; payload: Uint8Array } {
  const bytes = base64UrlToBytes(value);
  if (bytes.length <= KEY_WRAP_HEADER_BYTES) throw new Error('KEY_WRAP_MALFORMED: too short');
  if (bytes[0] !== ENVELOPE_VERSION) throw new Error(`KEY_WRAP_MALFORMED: version ${bytes[0]}`);
  return { algorithm: bytes[1]!, payload: bytes.slice(KEY_WRAP_HEADER_BYTES) };
}

/** Structural validation only — the server never opens a wrap, whichever algorithm made it. */
export function isWellFormedKeyWrap(value: unknown): value is Envelope<WrappedKey> {
  if (typeof value !== 'string' || value.length === 0) return false;
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(value);
  } catch {
    return false;
  }
  if (bytes[0] !== ENVELOPE_VERSION) return false;
  if (bytes[1] === ALG_AES_256_GCM) return bytes.length >= MIN_ENVELOPE_BYTES;
  if (bytes[1] === ALG_RSA_OAEP) return bytes.length > KEY_WRAP_HEADER_BYTES;
  return false;
}

export function assertKeyWrap(value: unknown, field: string): Envelope<WrappedKey> {
  if (!isWellFormedKeyWrap(value)) throw new Error(`ENVELOPE_MALFORMED: ${field}`);
  return value as Envelope<WrappedKey>;
}

/** Assert-and-narrow for route handlers. Throws so a malformed body cannot pass silently. */
export function assertEnvelope<T>(value: unknown, field: string): Envelope<T> {
  if (!isWellFormedEnvelope(value)) {
    throw new Error(`ENVELOPE_MALFORMED: ${field}`);
  }
  return value as Envelope<T>;
}

/**
 * Frame an envelope from its parts. Exported for the client's crypto module and for
 * known-answer tests; it performs no encryption itself.
 */
export function frameEnvelope(nonce: Uint8Array, ciphertextWithTag: Uint8Array): string {
  if (nonce.length !== NONCE_BYTES) throw new Error(`nonce must be ${NONCE_BYTES} bytes`);
  if (ciphertextWithTag.length < TAG_BYTES) throw new Error('ciphertext missing auth tag');
  const out = new Uint8Array(HEADER_BYTES + ciphertextWithTag.length);
  out[0] = ENVELOPE_VERSION;
  out[1] = ALG_AES_256_GCM;
  out.set(nonce, 2);
  out.set(ciphertextWithTag, HEADER_BYTES);
  return bytesToBase64Url(out);
}

/** Inverse of frameEnvelope. Does not decrypt. */
export function unframeEnvelope(envelope: string): {
  version: number;
  algorithm: number;
  nonce: Uint8Array;
  ciphertextWithTag: Uint8Array;
} {
  const bytes = base64UrlToBytes(envelope);
  if (bytes.length < MIN_ENVELOPE_BYTES) throw new Error('ENVELOPE_MALFORMED: too short');
  const version = bytes[0]!;
  const algorithm = bytes[1]!;
  if (version !== ENVELOPE_VERSION) throw new Error(`ENVELOPE_MALFORMED: version ${version}`);
  if (algorithm !== ALG_AES_256_GCM) throw new Error(`ENVELOPE_MALFORMED: algorithm ${algorithm}`);
  return {
    version,
    algorithm,
    nonce: bytes.slice(2, HEADER_BYTES),
    ciphertextWithTag: bytes.slice(HEADER_BYTES),
  };
}
