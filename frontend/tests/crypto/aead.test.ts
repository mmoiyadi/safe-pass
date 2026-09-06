/** AES-256-GCM known-answer tests (Principle IV). Vectors from NIST CAVP gcmEncryptExtIV256. */
import { describe, expect, it } from 'vitest';
import { aesGcmEncryptRaw, aesGcmDecryptRaw } from '../../src/crypto/envelope.js';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

describe('AES-256-GCM — NIST CAVP vectors', () => {
  it('encrypts the zero-length-plaintext vector to the reference tag', async () => {
    const key = fromHex('b52c505a37d78eda5dd34f20c22540ea1b58963cf8e5bf8ffa85f9f2492505b4');
    const iv = fromHex('516c33929df5a3284ff463d7');
    const out = await aesGcmEncryptRaw(key, iv, new Uint8Array(0));
    expect(hex(out)).toBe('bdc1ac884d332457a1d2664f168c76f0');
  });

  it('round-trips a non-empty plaintext', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('correct horse battery staple');
    const ct = await aesGcmEncryptRaw(key, iv, plaintext);
    expect(hex(await aesGcmDecryptRaw(key, iv, ct))).toBe(hex(plaintext));
  });

  it('refuses to decrypt under a different key', async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await aesGcmEncryptRaw(new Uint8Array(32).fill(1), iv, new Uint8Array([1, 2, 3]));
    await expect(aesGcmDecryptRaw(new Uint8Array(32).fill(2), iv, ct)).rejects.toThrow();
  });
});
