/**
 * Envelope round-trip and negative cases (Principle IV, FR-018).
 *
 * The negative cases are the point. A tampered ciphertext must fail loudly; it must never be
 * retried, ignored, or "best-effort" decrypted into wrong values.
 */
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../../src/crypto/envelope.js';
import {
  ENVELOPE_VERSION,
  ALG_AES_256_GCM,
  base64UrlToBytes,
  bytesToBase64Url,
  isWellFormedEnvelope,
  unframeEnvelope,
} from '../../../shared/src/envelope.js';

const key = () => crypto.getRandomValues(new Uint8Array(32));

describe('envelope round-trip', () => {
  it('recovers the exact plaintext', async () => {
    const k = key();
    const env = await encrypt(k, 'correct horse battery staple');
    expect(await decrypt(k, env)).toBe('correct horse battery staple');
  });

  it('handles empty strings and multi-byte unicode', async () => {
    const k = key();
    for (const text of ['', 'ünïcodé ✓', '🔐🔑', 'a'.repeat(10_000)]) {
      expect(await decrypt(k, await encrypt(k, text))).toBe(text);
    }
  });

  it('writes the documented header', async () => {
    const framed = unframeEnvelope(await encrypt(key(), 'x'));
    expect(framed.version).toBe(ENVELOPE_VERSION);
    expect(framed.algorithm).toBe(ALG_AES_256_GCM);
    expect(framed.nonce).toHaveLength(12);
  });
});

describe('nonce uniqueness', () => {
  /**
   * Nonce reuse under AES-GCM is catastrophic: two messages under one key and nonce leak
   * their XOR and permit forgery. The invariant is a fresh random nonce per encryption.
   */
  it('never repeats a nonce across many encryptions with one key', async () => {
    const k = key();
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const nonce = unframeEnvelope(await encrypt(k, 'same plaintext every time')).nonce;
      const asHex = [...nonce].map((b) => b.toString(16)).join('');
      expect(seen.has(asHex)).toBe(false);
      seen.add(asHex);
    }
  });

  it('produces different ciphertext for identical plaintext', async () => {
    const k = key();
    expect(await encrypt(k, 'same')).not.toBe(await encrypt(k, 'same'));
  });
});

describe('tamper detection (FR-018)', () => {
  it('fails on a single-bit flip anywhere in the ciphertext', async () => {
    const k = key();
    const env = await encrypt(k, 'correct horse battery staple');
    const bytes = base64UrlToBytes(env);

    for (let i = 14; i < bytes.length; i++) {
      const mutated = Uint8Array.from(bytes);
      mutated[i] = mutated[i]! ^ 0x01;
      await expect(decrypt(k, bytesToBase64Url(mutated) as typeof env)).rejects.toThrow();
    }
  });

  it('fails on a flipped nonce', async () => {
    const k = key();
    const bytes = base64UrlToBytes(await encrypt(k, 'x'));
    bytes[5] = bytes[5]! ^ 0xff;
    await expect(decrypt(k, bytesToBase64Url(bytes) as never)).rejects.toThrow();
  });

  it('fails on a truncated envelope', async () => {
    const k = key();
    const bytes = base64UrlToBytes(await encrypt(k, 'correct horse'));
    await expect(decrypt(k, bytesToBase64Url(bytes.slice(0, -1)) as never)).rejects.toThrow();
  });

  it('rejects an unknown version byte rather than guessing', async () => {
    const bytes = base64UrlToBytes(await encrypt(key(), 'x'));
    bytes[0] = 0x02;
    expect(isWellFormedEnvelope(bytesToBase64Url(bytes))).toBe(false);
  });
});

describe('structural validation (what the server is allowed to do)', () => {
  it('accepts a well-formed envelope', async () => {
    expect(isWellFormedEnvelope(await encrypt(key(), 'x'))).toBe(true);
  });

  it('rejects arbitrary strings, empty input, and non-strings', () => {
    for (const bad of ['', 'not-an-envelope', 'AQ', null, undefined, 42, {}]) {
      expect(isWellFormedEnvelope(bad)).toBe(false);
    }
  });
});
