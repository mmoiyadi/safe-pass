/**
 * Second factor (T106, T107, T111, FR-012 to FR-015).
 *
 * The seed is sealed under the UserKey, so the server CANNOT verify a code. The flow is:
 *
 *   password authenticates  → a PENDING session, which may fetch the wrapped seed and nothing
 *                             else
 *   client unwraps, computes, compares locally, presents the result
 *   server upgrades the session
 *
 * The honest limitation, recorded in contracts/README.md: a fully compromised client can skip
 * the check. Second factor here raises the cost of a STOLEN PASSWORD — the realistic threat —
 * and is not a defence against a compromised device. Storing the seed server-side in plaintext
 * would make verification authoritative and would hand the operator a credential it must not
 * hold.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError, assertKeyWrap, base64UrlToBytes, bytesToBase64Url, notFound } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { authLimit } from '../../middleware/rate-limit.js';
import { issueBackupCodes, redeemBackupCode, remainingBackupCodes } from './backup-codes.js';
import { notify, recordSignIn } from '../activity/sign-in-events.js';

const bytes = (envelope: string): Buffer => Buffer.from(base64UrlToBytes(envelope));
const text = (column: Uint8Array): string => bytesToBase64Url(new Uint8Array(column));

const authDigest = (authHash: string): Buffer =>
  createHash('sha256').update(Buffer.from(authHash, 'base64url')).digest();

/** Requires the master password itself, not merely a live session. */
async function requireMasterPassword(
  prisma: PrismaClient,
  userId: string,
  authHash: unknown,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const candidate = authDigest(String(authHash ?? ''));
  const stored = Buffer.from(user.authHashDigest);
  if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) {
    throw new ApiError('AUTH_FAILED', 'That master password is not correct');
  }
}

export function totpRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /* ------------------------------- status ------------------------------- */
    app.get('/totp', async (request) => {
      const userId = request.session!.userId;
      const enrolment = await prisma.totpEnrolment.findUnique({ where: { userId } });
      return {
        enrolled: enrolment?.confirmedAt != null,
        backupCodesRemaining: await remainingBackupCodes(prisma, userId),
      };
    });

    /* -------------------------------- enrol ------------------------------- */
    /**
     * The seed is generated on the client and arrives already sealed under the UserKey. The
     * server stores an envelope it cannot open, and confirmation is the client's assertion that
     * it produced a matching code — which is all the server can ever have here.
     */
    app.post('/totp/enrol', { config: authLimit }, async (request, reply) => {
      const userId = request.session!.userId;
      const body = request.body as Record<string, unknown>;

      const wrappedSecret = assertKeyWrap(body['wrappedSecret'], 'wrappedSecret');
      if (body['confirmed'] !== true) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'Enrolment must be confirmed by entering a code from the authenticator app first',
        );
      }

      const codes = await prisma.$transaction(async (tx) => {
        await tx.totpEnrolment.upsert({
          where: { userId },
          create: { userId, wrappedSecret: bytes(wrappedSecret), confirmedAt: new Date() },
          update: { wrappedSecret: bytes(wrappedSecret), confirmedAt: new Date(), lastUsedStep: null },
        });
        return null;
      });
      void codes;

      // Issued after the enrolment lands, so a failure cannot leave codes for a factor that
      // does not exist.
      const backupCodes = await issueBackupCodes(prisma, userId);

      return reply.code(201).send({
        backupCodes,
        warning:
          'These are shown once and never again. Each works a single time. Without your ' +
          'authenticator app AND these codes, there is no way back into this account.',
      });
    });

    /* ------------------------------ challenge ----------------------------- */
    /**
     * The only thing a pending session may fetch.
     *
     * It returns the wrapped UserKey as well as the wrapped seed, because the seed is sealed
     * UNDER the UserKey — without it the client cannot compute a code at all. Both are wrapped
     * material and neither discloses anything: opening either still requires the master
     * password, which the server never has. What a pending session still cannot reach is any
     * vault, any secret, or the RSA private key.
     */
    app.get('/totp/challenge', async (request) => {
      const userId = request.session!.userId;
      const [enrolment, keyring] = await Promise.all([
        prisma.totpEnrolment.findUnique({ where: { userId } }),
        prisma.userKeyring.findUnique({ where: { userId } }),
      ]);
      if (!enrolment?.confirmedAt || !keyring) throw notFound();
      return {
        wrappedSecret: text(enrolment.wrappedSecret),
        wrappedUserKey: text(keyring.wrappedUserKey),
        lastUsedStep: enrolment.lastUsedStep === null ? null : Number(enrolment.lastUsedStep),
      };
    });

    /* -------------------------------- verify ------------------------------ */
    app.post('/totp/verify', { config: authLimit }, async (request, reply) => {
      const session = request.session!;
      const body = request.body as Record<string, unknown>;
      const enrolment = await prisma.totpEnrolment.findUnique({ where: { userId: session.userId } });
      if (!enrolment?.confirmedAt) throw notFound();

      // Either a step the client verified, or a backup code the server can check itself.
      const backupCode = typeof body['backupCode'] === 'string' ? body['backupCode'] : null;

      if (backupCode) {
        if (!(await redeemBackupCode(prisma, session.userId, backupCode))) {
          await recordSignIn(prisma, session.userId, 'bad_totp', {
            userAgent: request.headers['user-agent'],
          });
          throw new ApiError('TOTP_INVALID', 'That backup code is not valid, or has been used');
        }
        await notify(prisma, session.userId, 'backup_code_used');
      } else {
        const step = Number(body['step']);
        if (!Number.isInteger(step)) {
          throw new ApiError('TOTP_INVALID', 'A verified time step is required');
        }

        // The server cannot check the code, but it CAN refuse a step that has already been
        // spent — which is the replay protection FR-013 asks for, enforced where the client
        // has no vote (see the limitation at the top of this file).
        const last = enrolment.lastUsedStep === null ? null : Number(enrolment.lastUsedStep);
        if (last !== null && step <= last) {
          await recordSignIn(prisma, session.userId, 'bad_totp', {
            userAgent: request.headers['user-agent'],
          });
          throw new ApiError('TOTP_INVALID', 'That code has already been used');
        }

        // Refuse a step far from now, so a client cannot claim an arbitrary future one.
        const now = Math.floor(Date.now() / 1000 / 30);
        if (Math.abs(step - now) > 1) {
          throw new ApiError('TOTP_INVALID', 'That code has expired');
        }

        await prisma.totpEnrolment.update({
          where: { userId: session.userId },
          data: { lastUsedStep: BigInt(step) },
        });
      }

      await prisma.session.update({ where: { id: session.id }, data: { pendingTotp: false } });

      const { newDevice } = await recordSignIn(prisma, session.userId, 'success', {
        userAgent: request.headers['user-agent'],
      });
      if (newDevice) await notify(prisma, session.userId, 'new_device');

      return reply.code(204).send();
    });

    /* -------------------------------- remove ------------------------------ */
    /**
     * FR-015 says "after re-authenticating". This requires the master password rather than a
     * live session, because removing the second factor is the step an intruder on a stolen
     * session takes before locking the owner out — and there is no recovery to undo that.
     */
    app.delete('/totp', { config: authLimit }, async (request, reply) => {
      const userId = request.session!.userId;
      await requireMasterPassword(prisma, userId, (request.body as Record<string, unknown>)['authHash']);

      const enrolment = await prisma.totpEnrolment.findUnique({ where: { userId } });
      if (!enrolment) throw notFound();

      await prisma.$transaction(async (tx) => {
        await tx.totpEnrolment.delete({ where: { userId } });
        // Codes for a factor that no longer exists must not keep working.
        await tx.backupCode.deleteMany({ where: { userId } });
      });

      await notify(prisma, userId, 'totp_removed');
      return reply.code(204).send();
    });

    /* --------------------------- backup codes ----------------------------- */
    app.post('/totp/backup-codes', { config: authLimit }, async (request) => {
      const userId = request.session!.userId;
      await requireMasterPassword(prisma, userId, (request.body as Record<string, unknown>)['authHash']);

      const enrolment = await prisma.totpEnrolment.findUnique({ where: { userId } });
      if (!enrolment?.confirmedAt) throw notFound();

      return {
        backupCodes: await issueBackupCodes(prisma, userId),
        warning: 'Any codes you were issued before now have stopped working.',
      };
    });
  };
}

/** Sign-in history (T111, FR-008, research.md §9). */
export function securityRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    app.get('/security/sign-ins', async (request) => {
      const rows = await prisma.signInEvent.findMany({
        where: { userId: request.session!.userId },
        orderBy: { at: 'desc' },
        take: 200,
      });
      return rows.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        at: r.at.toISOString(),
        coarseLocation: r.coarseLocation,
        deviceLabel: r.deviceLabel,
      }));
    });
  };
}
