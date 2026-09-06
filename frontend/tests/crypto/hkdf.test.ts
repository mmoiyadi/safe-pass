/** HKDF-SHA256 known-answer tests (Principle IV). Vectors from RFC 5869 Appendix A.1. */
import { describe, expect, it } from 'vitest';
import { deriveStretchedMasterKey, hkdfExpand } from '../../src/crypto/master-key.js';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

describe('HKDF-SHA256 — RFC 5869 Appendix A.1', () => {
  it('expands the reference PRK to the reference OKM', async () => {
    const prk = fromHex('077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5');
    const info = fromHex('f0f1f2f3f4f5f6f7f8f9');
    expect(hex(await hkdfExpand(prk, info, 42))).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });
});

describe('deriveStretchedMasterKey', () => {
  it('produces exactly 32 bytes — there is no separate macKey', async () => {
    expect(await deriveStretchedMasterKey(new Uint8Array(32).fill(7))).toHaveLength(32);
  });

  it('is deterministic', async () => {
    const mk = new Uint8Array(32).fill(9);
    expect(hex(await deriveStretchedMasterKey(mk))).toBe(hex(await deriveStretchedMasterKey(mk)));
  });

  it('differs from the master key it stretches', async () => {
    const mk = new Uint8Array(32).fill(9);
    expect(hex(await deriveStretchedMasterKey(mk))).not.toBe(hex(mk));
  });
});
