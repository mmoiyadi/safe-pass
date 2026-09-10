/**
 * The issuer is a label, never an input to verification (T004, FR-004, Constitution IV).
 *
 * Written and passing against the UNMODIFIED `totp.ts`, before the rebrand changes the default.
 * A test written afterwards passes by construction and evidences nothing about preservation.
 *
 * The guarantee this protects is concrete: somebody enrolled a second factor under the old name,
 * their authenticator app stored that label with the secret, and after the rename their existing
 * entry must keep working. It does — but "must" is a promise, and a promise about a second factor
 * is worth evidence rather than confidence.
 */
import { describe, expect, it } from 'vitest';
import { buildOtpAuthUri, generateCode, generateTotpSecret, verifyCode } from '../../src/crypto/totp.js';

const AT = 1_700_000_000_000;

describe('the issuer does not participate in verification', () => {
  it('accepts a code from an enrolment made under a different issuer', async () => {
    const secret = generateTotpSecret();

    // Enrolled under the old name — the URI an authenticator app would have scanned.
    const enrolled = buildOtpAuthUri({ secret, account: 'alice@example.com', issuer: 'Password Manager' });
    expect(enrolled).toContain('issuer=Password%20Manager');

    // The app generates from the secret alone; the label never enters the computation.
    const code = await generateCode(secret, { at: AT });
    const result = await verifyCode(secret, code, { at: AT });

    expect(result.ok).toBe(true);
  });

  it('produces the same code regardless of which issuer the URI carried', async () => {
    const secret = generateTotpSecret();

    buildOtpAuthUri({ secret, account: 'alice@example.com', issuer: 'Password Manager' });
    const before = await generateCode(secret, { at: AT });

    buildOtpAuthUri({ secret, account: 'alice@example.com', issuer: 'Cairn' });
    const after = await generateCode(secret, { at: AT });

    expect(after).toBe(before);
  });

  it('still rejects a wrong code, so the test is not passing vacuously', async () => {
    const secret = generateTotpSecret();
    const code = await generateCode(secret, { at: AT });
    const wrong = code === '000000' ? '111111' : '000000';

    expect((await verifyCode(secret, wrong, { at: AT })).ok).toBe(false);
  });

  it('carries whatever issuer it is given, so the rename is visible to new enrolments', () => {
    const secret = generateTotpSecret();
    const uri = buildOtpAuthUri({ secret, account: 'alice@example.com', issuer: 'Cairn' });
    expect(uri).toContain('issuer=Cairn');
  });
});
