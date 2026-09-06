/**
 * Revocation (T089, FR-080).
 *
 * Two things happen, and only the first is allowed to be on the critical path:
 *
 *  1. The member is refused, immediately and atomically — status set to `revoked` and EVERY key
 *     wrap they held deleted, at all generations. This is what SC-005's 60-second bound is
 *     about, and it does not wait for any re-encryption.
 *  2. A rotation becomes necessary, because a revoked member may have kept the vault key in
 *     memory or in an offline copy. The server CANNOT open that rotation itself: doing so needs
 *     a fresh vault key wrapped to every remaining member's public key, and the server holds no
 *     key to generate or wrap. An Owner's device opens it via POST /vaults/:id/rotation.
 *     Rotation bounds FUTURE exposure; it cannot un-read what the member already saw.
 *
 * Deleting only the current generation's wrap would be a subtle hole: mid-rotation the member
 * would still hold the other one.
 */
import { ApiError, notFound } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { record } from '../activity/record.js';

export async function revokeMember(
  prisma: PrismaClient,
  params: { vaultId: string; userId: string; actorId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const membership = await tx.vaultMembership.findFirst({
      where: { vaultId: params.vaultId, userId: params.userId },
    });
    if (!membership || membership.status === 'revoked') throw notFound();

    if (membership.role === 'owner') {
      const otherOwners = await tx.vaultMembership.count({
        where: {
          vaultId: params.vaultId,
          role: 'owner',
          status: 'active',
          userId: { not: params.userId },
        },
      });
      if (otherOwners === 0) {
        throw new ApiError('LAST_OWNER', 'A vault must keep at least one owner');
      }
    }

    await tx.vaultMembership.update({
      where: { id: membership.id },
      data: { status: 'revoked', revokedAt: new Date() },
    });

    // Every generation, not just the current one.
    await tx.vaultKeyWrap.deleteMany({ where: { membershipId: membership.id } });

    await record(tx, {
      vaultId: params.vaultId,
      actorId: params.actorId,
      subjectId: params.userId,
      action: 'revoked',
    });
  });
}
