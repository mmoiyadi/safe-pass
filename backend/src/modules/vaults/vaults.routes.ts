/**
 * Vault CRUD and membership (T079, T088).
 *
 * A vault's name is encrypted under its own vault key, so creating one means the client
 * supplies both the sealed name and a wrap of the key to its own public key. The server stores
 * both and can open neither.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError, assertEnvelope, assertKeyWrap, base64UrlToBytes, notFound } from '@pm/shared';
import type { PrismaClient, Role } from '../../../prisma/generated/client/index.js';
import { requireMembership } from './authz.js';
import { record } from '../activity/record.js';

const bytes = (envelope: string): Buffer => Buffer.from(base64UrlToBytes(envelope));

const ROLES = new Set<Role>(['owner', 'editor', 'viewer']);
const asRole = (raw: unknown): Role => {
  if (typeof raw !== 'string' || !ROLES.has(raw as Role)) {
    throw new ApiError('VALIDATION_FAILED', 'role must be owner, editor or viewer');
  }
  return raw as Role;
};

/**
 * A vault must never be left without an owner who can manage it (FR-035). Checked inside the
 * same transaction as the change, because two concurrent demotions would each see one other
 * owner and both succeed.
 */
async function assertNotLastOwner(
  tx: Pick<PrismaClient, 'vaultMembership'>,
  vaultId: string,
  userId: string,
): Promise<void> {
  const otherOwners = await tx.vaultMembership.count({
    where: { vaultId, role: 'owner', status: 'active', userId: { not: userId } },
  });
  if (otherOwners === 0) {
    throw new ApiError('LAST_OWNER', 'A vault must keep at least one owner');
  }
}

export function vaultRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /* ------------------------------- create ------------------------------- */
    app.post('/', async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const name = assertEnvelope(body['name'], 'name');
      const wrappedVaultKey = assertKeyWrap(body['wrappedVaultKey'], 'wrappedVaultKey');
      const userId = request.session!.userId;

      const vault = await prisma.$transaction(async (tx) => {
        const created = await tx.vault.create({
          data: { ownerId: userId, name: bytes(name), kind: 'standard' },
        });
        const membership = await tx.vaultMembership.create({
          data: {
            vaultId: created.id,
            userId,
            role: 'owner',
            status: 'active',
            acceptedAt: new Date(),
          },
        });
        await tx.vaultKeyWrap.create({
          data: { membershipId: membership.id, keyVersion: 1, wrappedVaultKey: bytes(wrappedVaultKey) },
        });
        await record(tx, { vaultId: created.id, actorId: userId, action: 'vault_created' });
        return created;
      });

      return reply.code(201).send({ id: vault.id, keyVersion: vault.keyVersion });
    });

    /* -------------------------------- rename ------------------------------- */
    app.patch('/:vaultId', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'owner');
      const name = assertEnvelope((request.body as Record<string, unknown>)['name'], 'name');
      const vault = await prisma.vault.findUniqueOrThrow({ where: { id: vaultId } });
      await prisma.vault.update({
        where: { id: vaultId },
        data: { name: bytes(name), nameKeyVersion: vault.keyVersion },
      });
      return { id: vaultId };
    });

    /* -------------------------------- delete ------------------------------- */
    app.delete('/:vaultId', async (request, reply) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'owner');

      const vault = await prisma.vault.findUniqueOrThrow({
        where: { id: vaultId },
        include: { memberships: { where: { status: { in: ['active', 'invited'] } } } },
      });

      // The personal vault is where a user's own secrets live; there is no state in which
      // deleting it is what someone meant. Account deletion removes it instead.
      if (vault.kind === 'personal') {
        throw new ApiError('LAST_OWNER', 'The personal vault cannot be deleted; delete the account instead');
      }

      // FR-024: a vault with other members cannot be deleted out from under them.
      const others = vault.memberships.filter((m) => m.userId !== request.session!.userId);
      if (others.length > 0) {
        throw new ApiError(
          'LAST_OWNER',
          'Remove the other members before deleting this vault — deleting it would destroy their access and its contents',
          { remainingMembers: others.length },
        );
      }

      await prisma.vault.delete({ where: { id: vaultId } });
      return reply.code(204).send();
    });

    /* ------------------------------- members ------------------------------- */
    app.get('/:vaultId/members', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'owner');
      const rows = await prisma.vaultMembership.findMany({
        where: { vaultId },
        include: { user: true, keyWraps: true },
      });
      return rows.map((m) => ({
        userId: m.userId,
        email: m.user.email,
        role: m.role,
        status: m.status,
        keyVersions: m.keyWraps.map((w) => w.keyVersion).sort(),
      }));
    });

    /** The invited member accepts, becoming active (FR-025). */
    app.post('/:vaultId/members/accept', async (request, reply) => {
      const { vaultId } = request.params as { vaultId: string };
      const userId = request.session!.userId;

      const membership = await prisma.vaultMembership.findFirst({
        where: { vaultId, userId, status: 'invited' },
      });
      if (!membership) throw notFound();

      await prisma.$transaction(async (tx) => {
        await tx.vaultMembership.update({
          where: { id: membership.id },
          data: { status: 'active', acceptedAt: new Date() },
        });
        await record(tx, { vaultId, actorId: userId, subjectId: userId, action: 'accepted' });
      });
      return reply.code(204).send();
    });

    app.post('/:vaultId/members/decline', async (request, reply) => {
      const { vaultId } = request.params as { vaultId: string };
      const userId = request.session!.userId;
      const membership = await prisma.vaultMembership.findFirst({
        where: { vaultId, userId, status: 'invited' },
      });
      if (!membership) throw notFound();

      await prisma.$transaction(async (tx) => {
        // Declining removes the membership and its wraps outright: there is no reason to keep
        // key material for someone who said no.
        await tx.vaultMembership.delete({ where: { id: membership.id } });
        await record(tx, { vaultId, actorId: userId, subjectId: userId, action: 'declined' });
      });
      return reply.code(204).send();
    });

    /* ----------------------------- role change ----------------------------- */
    app.patch('/:vaultId/members/:userId', async (request, reply) => {
      const { vaultId, userId } = request.params as { vaultId: string; userId: string };
      const actorId = request.session!.userId;
      await requireMembership(prisma, vaultId, actorId, 'owner');
      const role = asRole((request.body as Record<string, unknown>)['role']);

      await prisma.$transaction(async (tx) => {
        const membership = await tx.vaultMembership.findFirst({ where: { vaultId, userId } });
        if (!membership) throw notFound();

        if (membership.role === 'owner' && role !== 'owner') {
          await assertNotLastOwner(tx, vaultId, userId);
        }

        await tx.vaultMembership.update({ where: { id: membership.id }, data: { role } });
        await record(tx, {
          vaultId,
          actorId,
          subjectId: userId,
          action: 'role_changed',
          metadata: { from: membership.role, to: role },
        });
      });

      return reply.code(204).send();
    });
  };
}
