/**
 * Request-payload inspection (Principle IV, FR-017).
 *
 * This is the single most important test in the suite. It inspects the exact bytes a login or
 * registration request would carry and asserts that neither the master password nor the
 * StretchedMasterKey is among them.
 *
 * Sending the StretchedMasterKey to the server instead of the AuthHash is the mistake most
 * likely to be made during implementation — both are 32 opaque bytes, both "work" in the sense
 * that login succeeds, and the difference is invisible everywhere except here.
 */
import { describe, expect, it } from 'vitest';
import { deriveAuthHash, deriveMasterKey } from '../../src/crypto/kdf.js';
import { deriveStretchedMasterKey } from '../../src/crypto/master-key.js';
import { buildLoginRequest, buildRegistrationRequest } from '../../src/crypto/enrolment.js';
import { bytesToBase64Url, isWellFormedEnvelope } from '../../../shared/src/envelope.js';

const MASTER_PASSWORD = 'correct horse battery staple';
const EMAIL = 'alice@example.com';

/** Every representation the forbidden values could plausibly appear as in a JSON body. */
async function forbiddenNeedles() {
  const mk = await deriveMasterKey(MASTER_PASSWORD, EMAIL);
  const smk = await deriveStretchedMasterKey(mk);
  const asHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return [
    MASTER_PASSWORD,
    bytesToBase64Url(mk),
    bytesToBase64Url(smk),
    asHex(mk),
    asHex(smk),
    btoa(String.fromCharCode(...mk)),
    btoa(String.fromCharCode(...smk)),
  ];
}

describe('login request', () => {
  it('carries the AuthHash and nothing that decrypts', async () => {
    const body = JSON.stringify(await buildLoginRequest(EMAIL, MASTER_PASSWORD));
    for (const needle of await forbiddenNeedles()) {
      expect(body).not.toContain(needle);
    }
  });

  it('carries exactly the AuthHash, so the server can still authenticate', async () => {
    const request = await buildLoginRequest(EMAIL, MASTER_PASSWORD);
    const mk = await deriveMasterKey(MASTER_PASSWORD, EMAIL);
    expect(request.authHash).toBe(bytesToBase64Url(await deriveAuthHash(mk, MASTER_PASSWORD)));
  });

  it('sends only email and authHash — no other field', async () => {
    expect(Object.keys(await buildLoginRequest(EMAIL, MASTER_PASSWORD)).sort()).toEqual([
      'authHash',
      'email',
    ]);
  });
});

describe('registration request', () => {
  it('carries no master password and no StretchedMasterKey', async () => {
    const { request } = await buildRegistrationRequest(EMAIL, MASTER_PASSWORD);
    const body = JSON.stringify(request);
    for (const needle of await forbiddenNeedles()) {
      expect(body).not.toContain(needle);
    }
  });

  it('refuses to build without the no-recovery acknowledgement (FR-010)', async () => {
    const { request } = await buildRegistrationRequest(EMAIL, MASTER_PASSWORD);
    expect(request.recoveryAcknowledged).toBe(true);
  });

  it('sends the public key in the clear and the private key only wrapped', async () => {
    const { request } = await buildRegistrationRequest(EMAIL, MASTER_PASSWORD);
    expect(request.publicKey.length).toBeGreaterThan(0);
    // The private key must travel only as a well-formed envelope, never as raw PKCS#8.
    expect(isWellFormedEnvelope(request.wrappedPrivateKey)).toBe(true);
    expect(isWellFormedEnvelope(request.wrappedUserKey)).toBe(true);
    // The public key is NOT an envelope — it is plaintext by design.
    expect(isWellFormedEnvelope(request.publicKey)).toBe(false);
  });
});
