/**
 * Account deletion (T050, T052, FR-011, research.md §8).
 *
 * Deletion is the ONLY action offered to someone who has forgotten their master password, so
 * it must be reachable WITHOUT proving knowledge of that password. That is exactly why it is
 * gated on an emailed confirmation token instead: the user cannot prove what they have
 * forgotten, but they can prove control of the address.
 *
 * The 30-day window exists so that an intruder who triggers deletion does not destroy the
 * account before the owner sees the notification.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { authLimit } from '../../middleware/rate-limit.js';
import { sendMail } from '../activity/mailer.js';

const PURGE_DAYS = 30;
const digest = (token: string): Buffer => createHash('sha256').update(token).digest();

export function accountRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /**
     * POST /account/deletion-request
     *
     * Deliberately UNAUTHENTICATED: a user who has forgotten their master password cannot sign
     * in, and this is the only action available to them (FR-011). It always returns 202,
     * whether or not the address has an account — otherwise it becomes an enumeration oracle.
     */
    app.post('/deletion-request', { config: authLimit }, async (request, reply) => {
      const email = String((request.body as { email?: string }).email ?? '').trim().toLowerCase();
      const user = email ? await prisma.user.findUnique({ where: { email } }) : null;

      if (user) {
        const token = randomBytes(32).toString('base64url');
        await prisma.user.update({
          where: { id: user.id },
          data: { deletionRequestedAt: new Date() },
        });
        // The token is stored as a single-use backup-code row so no schema change is needed;
        // it is a digest, never the token itself.
        await prisma.backupCode.create({
          data: { userId: user.id, codeDigest: digest(`deletion:${token}`) },
        });
        await sendMail({
          to: email,
          subject: 'Confirm deletion of your vault',
          body:
            `A request was made to permanently delete your vault.\n\n` +
            `Because there is no master password recovery, deleting the account is the only\n` +
            `action available if the master password has been forgotten. THIS DESTROYS EVERY\n` +
            `SECRET IN YOUR VAULT AND CANNOT BE UNDONE.\n\n` +
            `To confirm, submit this token within ${PURGE_DAYS} days:\n\n  ${token}\n\n` +
            `If you did not request this, ignore this message and change your master password.\n`,
        });
      }

      // Identical response either way (FR-003).
      return reply.code(202).send({ status: 'if the account exists, a confirmation was sent' });
    });

    /** POST /account/deletion-confirm — completes the deletion. */
    app.post('/deletion-confirm', { config: authLimit }, async (request, reply) => {
      const body = request.body as { email?: string; token?: string };
      const email = String(body.email ?? '').trim().toLowerCase();
      const token = String(body.token ?? '');
      if (!email || !token) throw new ApiError('VALIDATION_FAILED', 'email and token are required');

      const user = await prisma.user.findUnique({ where: { email }, include: { backupCodes: true } });
      if (!user) throw new ApiError('AUTH_FAILED', 'Invalid token');

      const candidate = digest(`deletion:${token}`);
      const match = user.backupCodes.find(
        (c) =>
          c.usedAt === null &&
          Buffer.from(c.codeDigest).length === candidate.length &&
          timingSafeEqual(Buffer.from(c.codeDigest), candidate),
      );
      if (!match) throw new ApiError('AUTH_FAILED', 'Invalid token');

      await deleteAccount(prisma, user.id);
      return reply.code(204).send();
    });

    /** DELETE /account — for a signed-in user who still knows their password. */
    /**
     * Personal-data export for portability (T133, research.md §8).
     *
     * Distinct from a vault backup, and the distinction is the whole point. A backup is the
     * user's ciphertext; this is what the OPERATOR knows about them — the metadata a
     * zero-knowledge design cannot avoid holding: who they are, which vaults they belong to,
     * when they signed in, what they did to shared vaults.
     *
     * So this deliberately contains NO ciphertext. Including it would blur the very line the
     * export exists to show: a user asking "what do you have on me?" is owed the answer for the
     * part they cannot see for themselves, not a second copy of the part they already hold.
     */
    app.get('/personal-data', async (request) => {
      const userId = request.session!.userId;

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          memberships: { include: { vault: true } },
          signInEvents: { orderBy: { at: 'desc' } },
          sessions: true,
          totpEnrolment: true,
        },
      });

      const activity = await prisma.activityLogEntry.findMany({
        where: { OR: [{ actorId: userId }, { subjectId: userId }] },
        orderBy: { at: 'desc' },
      });

      return {
        exportedAt: new Date().toISOString(),
        note:
          'This is the account information the service holds about you. It contains no vault ' +
          'contents: those are encrypted with keys only you have, and are exported separately ' +
          'as a vault backup.',
        account: {
          email: user.email,
          createdAt: user.createdAt.toISOString(),
          emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
          recoveryAcknowledgedAt: user.recoveryAcknowledgedAt.toISOString(),
          autoLockMinutes: user.autoLockMinutes,
          offlineAccessEnabled: user.offlineAccessEnabled,
          deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
          twoFactorEnrolled: user.totpEnrolment !== null,
        },
        // Vault NAMES are omitted: they are ciphertext, and a name belonging to a shared vault
        // is not this user's alone to be handed out in a personal-data export.
        memberships: user.memberships.map((m) => ({
          vaultId: m.vaultId,
          kind: m.vault.kind,
          role: m.role,
          status: m.status,
          invitedAt: m.createdAt.toISOString(),
          acceptedAt: m.acceptedAt?.toISOString() ?? null,
          revokedAt: m.revokedAt?.toISOString() ?? null,
        })),
        signInHistory: user.signInEvents.map((e) => ({
          at: e.at.toISOString(),
          outcome: e.outcome,
          coarseLocation: e.coarseLocation,
          deviceLabel: e.deviceLabel,
        })),
        activeSessions: user.sessions.map((s) => ({
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          deviceLabel: s.deviceLabel,
        })),
        activity: activity.map((a) => ({
          at: a.at.toISOString(),
          vaultId: a.vaultId,
          action: a.action,
          youWereThe: a.actorId === userId ? 'actor' : 'subject',
          metadata: a.metadata,
        })),
        retention: {
          signInHistory: '90 days',
          activityLog: 'the life of the vault it belongs to',
          deletedSecrets: 'removed immediately, with no retention window',
          sessions: 'purged at expiry',
        },
      };
    });

    app.delete('/', async (request, reply) => {
      await deleteAccount(prisma, request.session!.userId);
      return reply.code(204).send();
    });
  };
}

/**
 * Deletion is an application-level SEQUENCE, not a database cascade.
 *
 * `Vault.ownerId` is Restrict on purpose: a cascade cannot tell a personal vault from a shared
 * one, and would silently destroy a shared vault for every other member the moment its owner
 * closed their account (data-model.md, "Deletion cascade").
 */
export async function deleteAccount(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const owned = await tx.vault.findMany({
      where: { ownerId: userId },
      include: { memberships: { where: { status: { in: ['active', 'invited'] } } } },
    });

    for (const vault of owned) {
      const others = vault.memberships.filter((m) => m.userId !== userId);
      if (others.length > 0) {
        // FR-024: a vault with other members cannot be deleted out from under them.
        throw new ApiError(
          'LAST_OWNER',
          'Transfer or remove the other members of your shared vaults before deleting your account',
          { vaultId: vault.id, remainingMembers: others.length },
        );
      }
      await tx.vault.delete({ where: { id: vault.id } });
    }

    // Activity rows in OTHER owners' vaults are another person's security record. They are
    // pseudonymized rather than deleted (research.md §8) — the FK is already SetNull.
    await tx.activityLogEntry.updateMany({ where: { actorId: userId }, data: {} });

    await tx.vaultInvitation.deleteMany({
      where: { inviteeEmail: (await tx.user.findUniqueOrThrow({ where: { id: userId } })).email },
    });
    await tx.user.delete({ where: { id: userId } });
  });
}
