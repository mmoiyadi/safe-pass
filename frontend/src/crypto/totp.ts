/**
 * TOTP (T105, RFC 6238).
 *
 * Verification happens on the client, not the server, because the seed is sealed under the
 * user's own key (FR-012) and the server holds nothing that opens it. The consequence is
 * recorded honestly in contracts/README.md: a fully compromised client can skip the check.
 * Second factor here raises the cost of a *stolen password*, which is the realistic threat; it
 * is not a defence against a compromised device.
 */
import { TOTP, Secret } from 'otpauth';

export const STEP_SECONDS = 30;
export const DEFAULT_DIGITS = 6;
/** One step either way. Wider windows keep a shoulder-surfed code usable for longer. */
const DRIFT_STEPS = 1;

export interface VerifyOptions {
  at?: number;
  digits?: number;
  /**
   * The newest step this account has already spent. A code matching this step or older is a
   * replay and is refused, whatever the arithmetic says (FR-013).
   */
  lastUsedStep?: number | undefined;
}

export interface VerifyResult {
  ok: boolean;
  /** Which time step matched. The caller stores it so the same code cannot be spent twice. */
  step: number;
}

export const currentStep = (at: number = Date.now()): number =>
  Math.floor(at / 1000 / STEP_SECONDS);

function build(secret: string, digits: number): TOTP {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits,
    period: STEP_SECONDS,
  });
}

/** 160 bits, matching the SHA-1 block the algorithm uses. */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export async function generateCode(
  secret: string,
  options: { at?: number; digits?: number } = {},
): Promise<string> {
  return build(secret, options.digits ?? DEFAULT_DIGITS).generate({
    timestamp: options.at ?? Date.now(),
  });
}

export async function verifyCode(
  secret: string,
  code: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const at = options.at ?? Date.now();
  const digits = options.digits ?? DEFAULT_DIGITS;

  // People type codes with a space in the middle because that is how apps display them.
  const cleaned = code.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(cleaned)) {
    return { ok: false, step: currentStep(at) };
  }

  const totp = build(secret, digits);
  // `delta` is how many steps away the match was: 0 now, -1 previous, +1 next, null for none.
  const delta = totp.validate({ token: cleaned, timestamp: at, window: DRIFT_STEPS });
  if (delta === null) return { ok: false, step: currentStep(at) };

  const matchedStep = currentStep(at) + delta;

  // A code is spendable once. Anything at or below the last spent step is a replay.
  if (options.lastUsedStep !== undefined && matchedStep <= options.lastUsedStep) {
    return { ok: false, step: matchedStep };
  }

  return { ok: true, step: matchedStep };
}

/** The URI an authenticator app scans. Carries the secret, so it never leaves the device. */
export function buildOtpAuthUri(params: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? 'Password Manager';
  return new TOTP({
    issuer,
    label: params.account,
    secret: Secret.fromBase32(params.secret),
    algorithm: 'SHA1',
    digits: DEFAULT_DIGITS,
    period: STEP_SECONDS,
  }).toString();
}
