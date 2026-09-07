import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

/**
 * Rate limiting (FR-004, and the constitution's requirement that authentication endpoints be
 * rate-limited).
 *
 * Keyed by IP. Login, unlock, TOTP, invitation, and public-key lookup are the routes an
 * attacker exercises: the first three to guess credentials, the last two to enumerate accounts.
 */
/**
 * Whether the per-route limits below actually bite.
 *
 * On everywhere real requests arrive. Off in suites that drive dozens of sign-ins from a single
 * address, where otherwise the limiter — not the behaviour under test — decides the result.
 * That the limits ARE applied is asserted separately in tests/security/rate-limit.test.ts.
 *
 * Read at route-registration time, which happens after buildServer sets it.
 */
let limitsEnabled = true;
export const setRateLimitEnabled = (enabled: boolean): void => {
  limitsEnabled = enabled;
};

const limit = (max: number, timeWindow: string) => ({
  get rateLimit() {
    return limitsEnabled ? { max, timeWindow } : false;
  },
});

export async function registerRateLimit(app: FastifyInstance, enabled = true): Promise<void> {
  setRateLimitEnabled(enabled);
  await app.register(rateLimit, {
    global: false,
    // The body must match the shared error model rather than Fastify's default shape. The
    // returned object becomes the error, so it has to carry `statusCode` — without it the
    // error handler cannot tell this from an unhandled fault and answers 500, turning a
    // working rate limit into a server error.
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    }),
  });
}

/** Strict: credential guessing. */
export const authLimit = limit(10, '15 minutes');

/** Account enumeration surfaces. Looser, because a legitimate client hits these while sharing. */
export const lookupLimit = limit(30, '15 minutes');

/** Invitation issuance, to stop a vault being used as a mail relay. */
export const inviteLimit = limit(20, '1 hour');
