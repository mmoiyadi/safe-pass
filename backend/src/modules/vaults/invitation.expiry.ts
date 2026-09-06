/**
 * Invitation expiry (T087, FR-071).
 *
 * A pending invitation must not linger indefinitely against an address the owner may no longer
 * intend to invite — an address that was mistyped, or belongs to someone who has since left.
 *
 * Exported as a plain function so it can be driven by a scheduler, a cron container, or a test,
 * rather than being tied to a timer inside the server process.
 */
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { record } from '../activity/record.js';

export async function expireStaleInvitations(prisma: PrismaClient): Promise<number> {
  const stale = await prisma.vaultInvitation.findMany({
    where: { state: { in: ['pending', 'ready'] }, expiresAt: { lt: new Date() } },
    select: { id: true, vaultId: true },
  });
  if (stale.length === 0) return 0;

  for (const invitation of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.vaultInvitation.update({ where: { id: invitation.id }, data: { state: 'expired' } });
      await record(tx, { vaultId: invitation.vaultId, actorId: null, action: 'invitation_expired' });
    });
  }
  return stale.length;
}

/** Runs the sweep hourly. Returns a stop function so a test or a shutdown can clear it. */
export function scheduleInvitationExpiry(prisma: PrismaClient): () => void {
  const handle = setInterval(() => void expireStaleInvitations(prisma).catch(() => {}), 60 * 60 * 1000);
  handle.unref?.();
  return () => clearInterval(handle);
}
