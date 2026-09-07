/**
 * TOTP (T103, FR-012, FR-013).
 *
 * Vectors from RFC 6238 Appendix B. The negative cases carry the weight: a code accepted twice
 * within one time step is a replay, and a window that is too generous turns a shoulder-surfed
 * code into a usable credential for minutes.
 *
 * Verification happens HERE rather than on the server, because the seed is sealed under the
 * user's own key and the server cannot read it. That is an honest consequence of the design,
 * and its limitation is recorded in contracts/README.md.
 */
import { describe, expect, it } from 'vitest';
import {
  buildOtpAuthUri,
  currentStep,
  generateTotpSecret,
  generateCode,
  verifyCode,
  STEP_SECONDS,
} from '../../src/crypto/totp.js';

/** RFC 6238's seed: the ASCII string "12345678901234567890", base32-encoded. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('RFC 6238 Appendix B vectors (SHA-1, 8 digits)', () => {
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  for (const [seconds, expected] of vectors) {
    it(`t=${seconds} produces ${expected}`, async () => {
      expect(await generateCode(RFC_SECRET, { at: seconds * 1000, digits: 8 })).toBe(expected);
    });
  }
});

describe('six-digit codes, as authenticator apps show them', () => {
  it('produces six digits', async () => {
    const code = await generateCode(RFC_SECRET, { at: 59_000 });
    expect(code).toMatch(/^\d{6}$/);
    // The six-digit code is the eight-digit one truncated from the left.
    expect('94287082'.endsWith(code)).toBe(true);
  });

  it('changes when the step changes, and not within one', async () => {
    const early = await generateCode(RFC_SECRET, { at: 60_000 });
    const sameStep = await generateCode(RFC_SECRET, { at: 60_000 + (STEP_SECONDS - 1) * 1000 });
    const nextStep = await generateCode(RFC_SECRET, { at: 60_000 + STEP_SECONDS * 1000 });

    expect(sameStep).toBe(early);
    expect(nextStep).not.toBe(early);
  });
});

describe('verification window', () => {
  const at = 1_000_000_000_000;

  it('accepts the current code', async () => {
    const code = await generateCode(RFC_SECRET, { at });
    expect(await verifyCode(RFC_SECRET, code, { at })).toEqual({ ok: true, step: currentStep(at) });
  });

  /** One step of drift each way covers a clock that is slightly out, and no more. */
  it('accepts one step of drift in each direction', async () => {
    const previous = await generateCode(RFC_SECRET, { at: at - STEP_SECONDS * 1000 });
    const next = await generateCode(RFC_SECRET, { at: at + STEP_SECONDS * 1000 });

    expect((await verifyCode(RFC_SECRET, previous, { at })).ok).toBe(true);
    expect((await verifyCode(RFC_SECRET, next, { at })).ok).toBe(true);
  });

  it('refuses two steps of drift — a wider window is a longer-lived credential', async () => {
    const tooOld = await generateCode(RFC_SECRET, { at: at - 2 * STEP_SECONDS * 1000 });
    const tooNew = await generateCode(RFC_SECRET, { at: at + 2 * STEP_SECONDS * 1000 });

    expect((await verifyCode(RFC_SECRET, tooOld, { at })).ok).toBe(false);
    expect((await verifyCode(RFC_SECRET, tooNew, { at })).ok).toBe(false);
  });

  it('refuses a wrong code, and a code from a different secret', async () => {
    expect((await verifyCode(RFC_SECRET, '000000', { at })).ok).toBe(false);

    const other = generateTotpSecret();
    const foreign = await generateCode(other, { at });
    expect((await verifyCode(RFC_SECRET, foreign, { at })).ok).toBe(false);
  });

  it('ignores spaces, which is how people actually type them', async () => {
    const code = await generateCode(RFC_SECRET, { at });
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect((await verifyCode(RFC_SECRET, spaced, { at })).ok).toBe(true);
  });

  it('refuses malformed input rather than throwing', async () => {
    for (const bad of ['', 'abcdef', '12345', '1234567']) {
      expect((await verifyCode(RFC_SECRET, bad, { at })).ok).toBe(false);
    }
  });
});

/**
 * FR-013: a previously used code must be rejected. Verification returns the step it matched so
 * the caller can refuse anything at or below the last one used.
 */
describe('replay within a step', () => {
  const at = 1_000_000_000_000;

  it('reports which step matched, so a replay can be refused', async () => {
    const code = await generateCode(RFC_SECRET, { at });
    const first = await verifyCode(RFC_SECRET, code, { at });
    expect(first.ok).toBe(true);

    // The same code a moment later matches the SAME step — which is what makes it a replay.
    const again = await verifyCode(RFC_SECRET, code, { at: at + 5_000 });
    expect(again.ok).toBe(true);
    expect(again.step).toBe(first.step);
  });

  it('refuses a code whose step is not newer than the last one used', async () => {
    const code = await generateCode(RFC_SECRET, { at });
    const used = currentStep(at);

    expect((await verifyCode(RFC_SECRET, code, { at, lastUsedStep: used })).ok).toBe(false);
    expect((await verifyCode(RFC_SECRET, code, { at, lastUsedStep: used - 1 })).ok).toBe(true);
  });

  it('still refuses a replayed code from the previous step', async () => {
    const previous = await generateCode(RFC_SECRET, { at: at - STEP_SECONDS * 1000 });
    const previousStep = currentStep(at - STEP_SECONDS * 1000);
    expect((await verifyCode(RFC_SECRET, previous, { at, lastUsedStep: previousStep })).ok).toBe(false);
  });
});

describe('enrolment', () => {
  it('generates a base32 secret of the expected length', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it('builds an otpauth URI an authenticator app can read', () => {
    const uri = buildOtpAuthUri({ secret: RFC_SECRET, account: 'alice@example.com', issuer: 'Password Manager' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain('issuer=Password%20Manager');
    expect(uri).toContain('alice%40example.com');
    expect(uri).toContain(`period=${STEP_SECONDS}`);
  });
});
