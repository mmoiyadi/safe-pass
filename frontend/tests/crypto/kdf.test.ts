/**
 * Argon2id known-answer tests (Principle IV).
 *
 * Vectors from RFC 9106 §5.3. These must pass before any code depends on the KDF: a
 * wrong-but-plausible derivation produces no visible error — it silently makes every account's
 * keys different from what the spec says, and only surfaces when a second implementation
 * cannot open the data.
 */
import { describe, expect, it } from 'vitest';
import { argon2id as nobleArgon2id } from '@noble/hashes/argon2';
import { argon2idRaw, deriveAuthHash, deriveMasterKey, DEFAULT_KDF_PARAMS } from '../../src/crypto/kdf.js';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('Argon2id correctness', () => {
  /**
   * RFC 9106 §5.3's vector uses a secret key and associated data. `hash-wasm` implements
   * neither and ignores them silently, so the vector cannot be asserted against it directly —
   * passing them yields a different hash with no error raised. It IS asserted here against
   * @noble/hashes, an independent implementation, to establish that reference as correct.
   */
  it('@noble/hashes reproduces the RFC 9106 §5.3 reference tag', () => {
    const tag = nobleArgon2id(new Uint8Array(32).fill(0x01), new Uint8Array(16).fill(0x02), {
      t: 3,
      m: 32,
      p: 4,
      dkLen: 32,
      key: new Uint8Array(8).fill(0x03),
      personalization: new Uint8Array(12).fill(0x04),
    });
    expect(hex(tag)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  });

  /**
   * The production path uses hash-wasm for speed (64 MiB of pure-JS Argon2 blows the ≤2s unlock
   * budget on mobile). This pins it against the reference above on the parameter shape this
   * system actually uses — password and salt only, no key, no associated data.
   */
  it('hash-wasm agrees with @noble/hashes on the parameters this system uses', async () => {
    const password = new Uint8Array(32).fill(0x01);
    const salt = new Uint8Array(16).fill(0x02);
    const wasm = await argon2idRaw({
      password,
      salt,
      parallelism: 4,
      memoryKib: 32,
      iterations: 3,
      outputLen: 32,
    });
    const noble = nobleArgon2id(password, salt, { t: 3, m: 32, p: 4, dkLen: 32 });
    expect(hex(wasm)).toBe(hex(noble));
  });

  it('agrees with the reference at the production parameters too', async () => {
    const password = new TextEncoder().encode('correct horse battery staple');
    const salt = new TextEncoder().encode('alice@example.com');
    const wasm = await argon2idRaw({
      password,
      salt,
      parallelism: 1,
      memoryKib: 8192,
      iterations: 3,
      outputLen: 32,
    });
    const noble = nobleArgon2id(password, salt, { t: 3, m: 8192, p: 1, dkLen: 32 });
    expect(hex(wasm)).toBe(hex(noble));
  });

  it('refuses a salt shorter than Argon2 permits, rather than producing a silent wrong answer', async () => {
    await expect(
      argon2idRaw({
        password: new Uint8Array(8),
        salt: new Uint8Array(4),
        parallelism: 1,
        memoryKib: 32,
        iterations: 1,
        outputLen: 32,
      }),
    ).rejects.toThrow(/at least 8 bytes/);
  });
});

describe('deriveMasterKey', () => {
  it('is deterministic for the same password and email', async () => {
    const a = await deriveMasterKey('correct horse battery staple', 'alice@example.com');
    const b = await deriveMasterKey('correct horse battery staple', 'alice@example.com');
    expect(hex(a)).toBe(hex(b));
  });

  it('normalises the email salt, so case and whitespace do not fork the key', async () => {
    const a = await deriveMasterKey('pw', 'Alice@Example.com');
    const b = await deriveMasterKey('pw', '  alice@example.com  ');
    expect(hex(a)).toBe(hex(b));
  });

  it('differs for a different password', async () => {
    const a = await deriveMasterKey('pw-one', 'alice@example.com');
    const b = await deriveMasterKey('pw-two', 'alice@example.com');
    expect(hex(a)).not.toBe(hex(b));
  });

  it('differs for the same password under a different account', async () => {
    const a = await deriveMasterKey('pw', 'alice@example.com');
    const b = await deriveMasterKey('pw', 'bob@example.com');
    expect(hex(a)).not.toBe(hex(b));
  });

  it('produces 32 bytes at the documented parameters', async () => {
    expect(DEFAULT_KDF_PARAMS).toEqual({
      algorithm: 'argon2id',
      memoryKib: 65536,
      iterations: 3,
      parallelism: 1,
    });
    expect(await deriveMasterKey('pw', 'alice@example.com')).toHaveLength(32);
  });
});

describe('deriveAuthHash', () => {
  it('is deterministic', async () => {
    const mk = await deriveMasterKey('pw', 'alice@example.com');
    expect(hex(await deriveAuthHash(mk, 'pw'))).toBe(hex(await deriveAuthHash(mk, 'pw')));
  });

  /**
   * The load-bearing assertion of the whole design. If the AuthHash were equal to the master
   * key — or derivable from it — the value sent to the server at login would also decrypt the
   * vault. See contracts/crypto-envelope.md.
   */
  it('is not the master key it was derived from', async () => {
    const mk = await deriveMasterKey('pw', 'alice@example.com');
    expect(hex(await deriveAuthHash(mk, 'pw'))).not.toBe(hex(mk));
  });
});
