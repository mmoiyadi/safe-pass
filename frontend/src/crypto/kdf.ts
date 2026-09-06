/**
 * Key derivation. See research.md §2 and contracts/crypto-envelope.md.
 *
 * Argon2id at m=64MiB, t=3, p=1 — well above OWASP's floor, because the master password is the
 * single point of failure and there is no recovery. p=1 because the browser WASM build is
 * single-threaded, so higher parallelism costs wall-clock time without adding real resistance.
 */
import { argon2id, pbkdf2 as hashWasmPbkdf2, sha256, createSHA256 } from 'hash-wasm';
import type { KdfParams } from '@pm/shared';

export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  memoryKib: 65536,
  iterations: 3,
  parallelism: 1,
};

/** Email is the salt, so derivation is reproducible on any device with no pre-auth round-trip. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const utf8 = (s: string) => new TextEncoder().encode(s);

function fromHex(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
}

/**
 * Thin wrapper over the primitive.
 *
 * Deliberately exposes NO `secret` (key) or `associatedData` parameter. Argon2 defines both,
 * but `hash-wasm` does not implement them and — importantly — **ignores them silently** rather
 * than throwing, so passing them yields a hash that is not what the caller asked for with no
 * error to notice. This design uses neither, so the safe move is to make them unrepresentable.
 * tests/crypto/kdf.test.ts pins this by cross-checking against an independent implementation.
 */
export async function argon2idRaw(opts: {
  password: Uint8Array;
  salt: Uint8Array;
  parallelism: number;
  memoryKib: number;
  iterations: number;
  outputLen: number;
}): Promise<Uint8Array> {
  if (opts.salt.length < 8) throw new Error('Argon2id requires a salt of at least 8 bytes');
  return fromHex(
    await argon2id({
      password: opts.password,
      salt: opts.salt,
      parallelism: opts.parallelism,
      memorySize: opts.memoryKib,
      iterations: opts.iterations,
      hashLength: opts.outputLen,
      outputType: 'hex',
    }),
  );
}

/**
 * MasterKey = Argon2id(masterPassword, salt = normalized email).
 * Never stored, never transmitted, memory only.
 */
export async function deriveMasterKey(
  masterPassword: string,
  email: string,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  // The contract says "salt = normalized email". Argon2 requires at least 8 bytes and a legal
  // address can be shorter ("a@b.co" is 6), so the email is hashed to a fixed-length salt.
  // Determinism and cross-device reproducibility are unchanged — the salt is still a pure
  // function of the address, needing no server round-trip before authentication.
  const salt = fromHex(await sha256(utf8('pm:v1:mksalt:' + normalizeEmail(email))));
  if (params.algorithm === 'pbkdf2') {
    // Documented fallback only, if the WASM build fails to load. Not memory-hard, so GPU and
    // ASIC attacks are dramatically cheaper; an account derived this way is flagged for upgrade.
    return fromHex(
      await hashWasmPbkdf2({
        password: utf8(masterPassword),
        salt,
        iterations: params.iterations,
        hashLength: 32,
        hashFunction: createSHA256(),
        outputType: 'hex',
      }),
    );
  }
  return argon2idRaw({
    password: utf8(masterPassword),
    salt,
    parallelism: params.parallelism,
    memoryKib: params.memoryKib,
    iterations: params.iterations,
    outputLen: 32,
  });
}

/**
 * AuthHash = Argon2id(MasterKey, salt = masterPassword, t=1).
 *
 * This is the ONLY derived value that may leave the device. It proves knowledge of the master
 * password and is computationally useless for decryption. It is NOT interchangeable with the
 * StretchedMasterKey — sending that one instead would be a total compromise of the design.
 */
export async function deriveAuthHash(
  masterKey: Uint8Array,
  masterPassword: string,
): Promise<Uint8Array> {
  // The contract says "salt = masterPassword". Argon2 requires a salt of at least 8 bytes and a
  // master password may be shorter, so the password is hashed to a fixed-length salt first.
  // Still deterministic from the password alone, and still domain-separated from the MasterKey
  // derivation, which salts with the email.
  const salt = fromHex(await sha256(utf8('pm:v1:authsalt:' + masterPassword)));
  return argon2idRaw({
    password: masterKey,
    salt,
    parallelism: 1,
    memoryKib: 65536,
    iterations: 1,
    outputLen: 32,
  });
}
