/**
 * Vault authorization.
 *
 * Resolves membership BEFORE any data is loaded, then checks the role. Loading first and
 * filtering after is how authorization bugs leak data through error messages and timing.
 *
 * A caller who is not an active member gets NOT_FOUND, identical to a vault that does not
 * exist (FR-030) — VAULT_FORBIDDEN would confirm the vault exists.
 */
import { ApiError, notFound } from '@pm/shared';
import type { PrismaClient, Role, VaultMembership } from '../../../prisma/generated/client/index.js';

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export async function requireMembership(
  prisma: PrismaClient,
  vaultId: string,
  userId: string,
  minimum: Role = 'viewer',
): Promise<VaultMembership> {
  const membership = await prisma.vaultMembership.findFirst({
    where: { vaultId, userId, status: 'active' },
  });
  if (!membership) throw notFound();

  if (RANK[membership.role] < RANK[minimum]) {
    // The caller IS a member, so acknowledging the vault leaks nothing they do not know.
    throw new ApiError('ROLE_INSUFFICIENT', `This action requires the ${minimum} role`);
  }
  return membership;
}
