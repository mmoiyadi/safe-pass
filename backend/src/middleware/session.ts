/**
 * The session guard.
 *
 * FR-073 is enforced HERE, and that placement is the whole point. A client that has already
 * unwrapped the UserKey holds it in memory and can keep decrypting whatever it has, so a
 * client-side "please re-enter your password" prompt is advisory and a hostile client ignores
 * it. Refusing in the guard removes the client's vote.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '@pm/shared';
import type { PrismaClient, Session } from '../../prisma/generated/client/index.js';
import { SESSION_COOKIE, findLiveSession, touch } from '../modules/auth/session.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
}

/** Routes reachable without a session at all. */
const PUBLIC = new Set([
  '/api/v1/health',
  '/api/v1/auth/kdf-params',
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  // Deliberately public: a user who has forgotten their master password cannot sign in, and
  // deletion is the only action available to them (FR-011). Gated by an emailed token instead.
  '/api/v1/account/deletion-request',
  '/api/v1/account/deletion-confirm',
]);

/** The ONLY route a session stamped reauthRequired may reach (FR-073). */
const REAUTH_ROUTE = '/api/v1/auth/reauth';

/** Reachable by a session that has not yet cleared the second factor. */
const PENDING_TOTP_ALLOWED = new Set(['/api/v1/auth/totp/challenge', '/api/v1/auth/totp/verify']);

export function makeSessionGuard(prisma: PrismaClient) {
  return async function sessionGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const path = request.url.split('?')[0] ?? '';
    if (PUBLIC.has(path)) return;

    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw new ApiError('AUTH_REQUIRED', 'Authentication required');

    const session = await findLiveSession(prisma, token);
    if (!session) throw new ApiError('AUTH_REQUIRED', 'Authentication required');

    if (session.reauthRequiredAt !== null && path !== REAUTH_ROUTE) {
      throw new ApiError(
        'REAUTH_REQUIRED',
        'The master password was changed on another device. Re-enter it to continue.',
      );
    }

    if (session.pendingTotp && !PENDING_TOTP_ALLOWED.has(path)) {
      throw new ApiError('TOTP_REQUIRED', 'Second factor required');
    }

    request.session = session;
    await touch(prisma, session.id);
  };
}
