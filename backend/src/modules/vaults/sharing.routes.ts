/**
 * Sharing routes (T081, T082, T085, T086).
 *
 * Inviting has two outcomes and the caller cannot tell which in advance without leaking whether
 * an address has an account. The client therefore looks up the public key first: if one comes
 * back it wraps the vault key and gets a membership; if not it invites without key material and
 * gets a pending invitation.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError, assertKeyWrap, base64UrlToBytes, bytesToBase64Url, notFound } from '@pm/shared';
import type { PrismaClient, Role } from '../../../prisma/generated/client/index.js';
import { requireMembership } from './authz.js';
import { record } from '../activity/record.js';
import { revokeMember } from './revoke.js';
import {
  completeInvitation,
  createPendingInvitation,
  withdrawInvitation,
} from './invitation.service.js';
import { inviteLimit, lookupLimit } from '../../middleware/rate-limit.js';

const bytes = (envelope: string): Buffer => Buffer.from(base64UrlToBytes(envelope));
const normalize = (email: string): string => String(email ?? '').trim().toLowerCase();

const ROLES = new Set<Role>(['owner', 'editor', 'viewer']);
const asRole = (raw: unknown): Role => {
  if (typeof raw !== 'string' || !ROLES.has(raw as Role)) {
    throw new ApiError('VALIDATION_FAILED', 'role must be owner, editor or viewer');
  }
  return raw as Role;
};

const invitationView = (i: {
  id: string;
  vaultId: string;
  inviteeEmail: string;
  role: Role;
  state: string;
  createdAt: Date;
  expiresAt: Date;
}) => ({
  id: i.id,
  vaultId: i.vaultId,
  inviteeEmail: i.inviteeEmail,
  role: i.role,
  state: i.state,
  createdAt: i.createdAt.toISOString(),
  expiresAt: i.expiresAt.toISOString(),
});

export function sharingRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /* --------------------------- invite a member --------------------------- */
    app.post('/:vaultId/members', { config: inviteLimit }, async (request, reply) => {
      const { vaultId } = request.params as { vaultId: string };
      const actorId = request.session!.userId;
      await requireMembership(prisma, vaultId, actorId, 'owner');

      const body = request.body as Record<string, unknown>;
      const email = normalize(body['email'] as string);
      const role = asRole(body['role']);
      if (!email.includes('@')) throw new ApiError('VALIDATION_FAILED', 'A valid email is required');

      const recipient = await prisma.user.findUnique({ where: { email } });

      // No account: a pending invitation, holding nothing (FR-066, FR-067).
      if (!recipient || recipient.emailVerifiedAt === null) {
        const invitation = await createPendingInvitation(prisma, {
          vaultId,
          inviteeEmail: email,
          role,
          invitedById: actorId,
          suppliedKeyMaterial: body['wrappedVaultKey'] !== undefined,
        });
        return reply.code(202).send(invitationView(invitation));
      }

      const existing = await prisma.vaultMembership.findFirst({
        where: { vaultId, userId: recipient.id, status: { in: ['active', 'invited'] } },
      });
      if (existing) throw new ApiError('INVITATION_EXISTS', 'That person is already a member');

      const wrappedVaultKey = assertKeyWrap(body['wrappedVaultKey'], 'wrappedVaultKey');
      const vault = await prisma.vault.findUniqueOrThrow({ where: { id: vaultId } });

      await prisma.$transaction(async (tx) => {
        const membership = await tx.vaultMembership.upsert({
          where: { vaultId_userId: { vaultId, userId: recipient.id } },
          create: { vaultId, userId: recipient.id, role, status: 'invited', invitedBy: actorId },
          // Re-inviting a revoked member issues a fresh wrap at the CURRENT generation.
          update: { role, status: 'invited', invitedBy: actorId, revokedAt: null },
        });
        await tx.vaultKeyWrap.deleteMany({ where: { membershipId: membership.id } });
        await tx.vaultKeyWrap.create({
          data: {
            membershipId: membership.id,
            keyVersion: vault.keyVersion,
            wrappedVaultKey: bytes(wrappedVaultKey),
          },
        });
        await record(tx, {
          vaultId,
          actorId,
          subjectId: recipient.id,
          action: 'invited',
          metadata: { role },
        });
      });

      return reply.code(201).send({ userId: recipient.id, role, status: 'invited' });
    });

    /* ------------------------------- revoke ------------------------------- */
    app.delete('/:vaultId/members/:userId', async (request, reply) => {
      const { vaultId, userId } = request.params as { vaultId: string; userId: string };
      const actorId = request.session!.userId;
      await requireMembership(prisma, vaultId, actorId, 'owner');
      await revokeMember(prisma, { vaultId, userId, actorId });
      return reply.code(204).send();
    });

    /* ----------------------------- invitations ----------------------------- */
    app.get('/:vaultId/invitations', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'owner');
      const rows = await prisma.vaultInvitation.findMany({
        where: { vaultId, state: { in: ['pending', 'ready'] } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(invitationView);
    });

    app.post('/:vaultId/invitations/:invitationId/complete', async (request, reply) => {
      const { vaultId, invitationId } = request.params as { vaultId: string; invitationId: string };
      const actorId = request.session!.userId;
      await requireMembership(prisma, vaultId, actorId, 'owner');

      const body = request.body as Record<string, unknown>;
      const membership = await completeInvitation(prisma, {
        vaultId,
        invitationId,
        actorId,
        wrappedVaultKey: bytes(assertKeyWrap(body['wrappedVaultKey'], 'wrappedVaultKey')),
        keyVersion: Number(body['keyVersion']),
      });
      return reply.code(201).send({ userId: membership.userId, status: membership.status });
    });

    app.delete('/:vaultId/invitations/:invitationId', async (request, reply) => {
      const { vaultId, invitationId } = request.params as { vaultId: string; invitationId: string };
      const actorId = request.session!.userId;
      await requireMembership(prisma, vaultId, actorId, 'owner');
      await withdrawInvitation(prisma, { vaultId, invitationId, actorId });
      return reply.code(204).send();
    });

    /* --------------------------- activity record --------------------------- */
    app.get('/:vaultId/activity', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId);
      const rows = await prisma.activityLogEntry.findMany({
        where: { vaultId },
        include: { actor: true },
        orderBy: { at: 'desc' },
        take: 200,
      });
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorEmail: r.actor?.email ?? null,
        subjectId: r.subjectId,
        at: r.at.toISOString(),
        metadata: r.metadata,
      }));
    });
  };
}

/** Routes that are not scoped to one vault. */
export function accountSharingRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /**
     * A public key is not secret and is required in order to share. Returns 404 identically for
     * "no such account" and "not verified", so it cannot be used to enumerate accounts.
     */
    app.get('/users/public-key', { config: lookupLimit }, async (request) => {
      const email = normalize((request.query as { email?: string }).email ?? '');
      const user = email
        ? await prisma.user.findUnique({ where: { email }, include: { keyring: true } })
        : null;
      if (!user || user.emailVerifiedAt === null || !user.keyring) throw notFound();
      // Stored as decoded bytes, so it must be re-encoded — Buffer.from(...).toString('utf8')
      // on a Bytes column silently yields garbage rather than an error.
      return { publicKey: bytesToBase64Url(new Uint8Array(user.keyring.publicKey)) };
    });

    /**
     * Invitations addressed to the caller. Discloses that an invitation exists and who sent it,
     * and nothing about the vault — no name, no size, no member list (FR-066).
     */
    app.get('/invitations', async (request) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: request.session!.userId } });
      const rows = await prisma.vaultInvitation.findMany({
        where: { inviteeEmail: user.email, state: { in: ['pending', 'ready'] } },
        include: { invitedBy: true },
      });
      return rows.map((i) => ({
        id: i.id,
        role: i.role,
        state: i.state,
        invitedByEmail: i.invitedBy.email,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      }));
    });
  };
}
