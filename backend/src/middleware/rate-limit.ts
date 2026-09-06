import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

/**
 * Rate limiting (FR-004, and the constitution's requirement that authentication endpoints be
 * rate-limited).
 *
 * Keyed by IP. Login, unlock, TOTP, invitation, and public-key lookup are the routes an
 * attacker exercises: the first three to guess credentials, the last two to enumerate accounts.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    // The error body must match the shared error model, not Fastify's default shape.
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    }),
  });
}

/** Strict: credential guessing. */
export const authLimit = {
  rateLimit: { max: 10, timeWindow: '15 minutes' },
};

/** Account enumeration surfaces. Looser, because a legitimate client hits these while sharing. */
export const lookupLimit = {
  rateLimit: { max: 30, timeWindow: '15 minutes' },
};

/** Invitation issuance, to stop a vault being used as a mail relay. */
export const inviteLimit = {
  rateLimit: { max: 20, timeWindow: '1 hour' },
};
