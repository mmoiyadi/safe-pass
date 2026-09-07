/**
 * Email address verification (T144).
 *
 * ## Why this exists
 *
 * Sharing is always with a named account (spec: "Sharing is always with a named, verified
 * account"). That name is worth nothing unless controlling the address was proved: otherwise
 * inviting `finance@company.example` hands a vault key to whoever registered that address first.
 * So `/users/public-key` returns 404 for an unverified account, and this is the flow that lifts
 * that.
 *
 * ## What it does NOT gate
 *
 * The user's own vault. Someone who has just registered can store and read their own secrets
 * immediately — holding a personal vault hostage to an email round-trip would be user-hostile
 * and would protect nobody, since there is no second party to mislead.
 *
 * ## The token
 *
 * Random, single-use, expiring, and stored only as a SHA-256 digest. The digest matters: a
 * database read must not let its holder verify an account and so become a valid share target.
 * Issuing a new token invalidates the previous one, so a link intercepted from an old message
 * stops working the moment the user asks for another.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { sendMail } from '../activity/mailer.js';

/** 24 hours: long enough for a mail that lands overnight, short enough to matter. */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

const digest = (token: string): Buffer => createHash('sha256').update(token).digest();

const appUrl = (): string => process.env['APP_URL'] ?? 'http://localhost:5173';

/**
 * Issues a fresh token and emails it, replacing any outstanding one.
 *
 * Exported so registration can call it directly: an account is created and its verification
 * sent in the same breath, and a failure to send must not roll back the registration.
 */
export async function issueVerification(
  prisma: Pick<PrismaClient, 'emailVerification'>,
  userId: string,
  email: string,
): Promise<void> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  // Supersede any outstanding token. A user who asks for another link has usually lost the
  // first one — or suspects it went astray — and both readings say the old one should die.
  await prisma.emailVerification.deleteMany({ where: { userId, usedAt: null } });
  await prisma.emailVerification.create({
    data: { userId, tokenDigest: digest(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });

  await sendMail({
    to: email,
    subject: 'Verify your email address',
    body:
      `Confirm this address so other people can share vaults with you:\n\n` +
      `${appUrl()}/verify?token=${token}\n\n` +
      `The link works once and expires in 24 hours.\n\n` +
      `Until you confirm, you can use your own vault normally — you just cannot be added to ` +
      `anyone else's. This link proves you control this mailbox; it does not unlock anything, ` +
      `and nobody can read your secrets with it.\n\n` +
      `If you did not create an account, ignore this message.\n`,
  });
}

export function verifyRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /**
     * Consumes a token. Deliberately unauthenticated: the link is opened from a mail client,
     * which is frequently not the browser holding the session — and may be a different device
     * entirely. Requiring a session here would fail exactly the people it claims to protect.
     */
    app.post('/verify', async (request, reply) => {
      const token = String((request.body as Record<string, unknown>)?.['token'] ?? '');
      if (!token) throw new ApiError('VALIDATION_FAILED', 'A verification token is required');

      const candidate = digest(token);
      const outstanding = await prisma.emailVerification.findMany({
        where: { usedAt: null, expiresAt: { gt: new Date() } },
      });

      // Compared in constant time. The set is small and scoped to live tokens, so this is a
      // scan of a handful of rows, not the table.
      const match = outstanding.find((row) => {
        const stored = Buffer.from(row.tokenDigest);
        return stored.length === candidate.length && timingSafeEqual(stored, candidate);
      });

      // One message for an unknown token, a used one, and an expired one. Distinguishing them
      // would tell someone probing links which of their guesses had ever been real.
      if (!match) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'That verification link is not valid. It may have been used already or expired — ' +
            'sign in and request a new one.',
        );
      }

      await prisma.$transaction(async (tx) => {
        // Conditional on still being unused, so two clicks cannot both consume it.
        const { count } = await tx.emailVerification.updateMany({
          where: { id: match.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (count !== 1) throw new ApiError('VALIDATION_FAILED', 'That verification link is not valid.');

        await tx.user.update({
          where: { id: match.userId },
          data: { emailVerifiedAt: new Date() },
        });
      });

      return reply.code(204).send();
    });

    /** Sends another link to the signed-in account's own address. */
    app.post('/verify/resend', async (request, reply) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: request.session!.userId } });

      // Already verified is not an error and is not reported as one: the response is identical
      // either way, so nothing here can be used to probe an account's state.
      if (user.emailVerifiedAt === null) {
        await issueVerification(prisma, user.id, user.email);
      }

      return reply.code(202).send();
    });

    /** Whether the signed-in user still needs to verify, for the banner. */
    app.get('/verify/status', async (request) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: request.session!.userId } });
      return { verified: user.emailVerifiedAt !== null };
    });
  };
}
