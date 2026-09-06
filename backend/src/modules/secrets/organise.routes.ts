/**
 * Folders and tags (T067, T068).
 *
 * Both have encrypted names, for the same reason vault names do: a folder called "Divorce
 * Lawyer" leaks on its own. That means both carry a `keyVersion` and both must be re-encrypted
 * by a key rotation — see the close precondition in the rotation routes.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError, assertEnvelope, base64UrlToBytes, bytesToBase64Url, notFound } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { requireMembership } from '../vaults/authz.js';

const bytes = (envelope: string): Buffer => Buffer.from(base64UrlToBytes(envelope));
const text = (column: Uint8Array): string => bytesToBase64Url(new Uint8Array(column));

/** What to do with a folder's contents when the folder goes. */
type Disposition = 'orphan' | 'cascade';

export function organiseRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /* ------------------------------ folders ------------------------------ */

    app.get('/:vaultId/folders', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId);
      const rows = await prisma.folder.findMany({ where: { vaultId }, orderBy: { createdAt: 'asc' } });
      return rows.map((f) => ({ id: f.id, name: text(f.name), keyVersion: f.keyVersion }));
    });

    app.post('/:vaultId/folders', async (request, reply) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'editor');
      const name = assertEnvelope((request.body as Record<string, unknown>)['name'], 'name');
      const vault = await prisma.vault.findUniqueOrThrow({ where: { id: vaultId } });
      const created = await prisma.folder.create({
        data: { vaultId, name: bytes(name), keyVersion: vault.keyVersion },
      });
      return reply.code(201).send({ id: created.id, keyVersion: created.keyVersion });
    });

    app.put('/:vaultId/folders/:folderId', async (request) => {
      const { vaultId, folderId } = request.params as { vaultId: string; folderId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'editor');
      const name = assertEnvelope((request.body as Record<string, unknown>)['name'], 'name');
      const existing = await prisma.folder.findFirst({ where: { id: folderId, vaultId } });
      if (!existing) throw notFound();
      const vault = await prisma.vault.findUniqueOrThrow({ where: { id: vaultId } });
      await prisma.folder.update({
        where: { id: folderId },
        data: { name: bytes(name), keyVersion: vault.keyVersion },
      });
      return { id: folderId };
    });

    /**
     * FR-048: the caller must state what happens to the contents. There is no default —
     * defaulting to `cascade` would silently destroy secrets, and defaulting to `orphan` would
     * quietly hide them from anyone who navigates by folder. Neither is safe to guess.
     */
    app.delete('/:vaultId/folders/:folderId', async (request, reply) => {
      const { vaultId, folderId } = request.params as { vaultId: string; folderId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'editor');

      const disposition = (request.query as { disposition?: string }).disposition as
        | Disposition
        | undefined;
      if (disposition !== 'orphan' && disposition !== 'cascade') {
        throw new ApiError(
          'VALIDATION_FAILED',
          "Deleting a folder requires ?disposition=orphan (keep the secrets, unfiled) or " +
            '?disposition=cascade (delete them permanently along with the folder)',
        );
      }

      const folder = await prisma.folder.findFirst({ where: { id: folderId, vaultId } });
      if (!folder) throw notFound();

      await prisma.$transaction(async (tx) => {
        if (disposition === 'cascade') {
          const doomed = await tx.secret.findMany({ where: { folderId }, select: { id: true } });
          await tx.secret.deleteMany({ where: { folderId } });
          // Each deletion is recorded individually — the log carries ids and nothing else,
          // because the titles are encrypted and were destroyed with the rows (FR-079).
          for (const s of doomed) {
            await tx.activityLogEntry.create({
              data: {
                vaultId,
                actorId: request.session!.userId,
                subjectId: s.id,
                action: 'secret_deleted',
              },
            });
          }
        } else {
          await tx.secret.updateMany({ where: { folderId }, data: { folderId: null } });
        }
        await tx.folder.delete({ where: { id: folderId } });
      });

      return reply.code(204).send();
    });

    /* -------------------------------- tags -------------------------------- */

    app.get('/:vaultId/tags', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId);
      const rows = await prisma.tag.findMany({ where: { vaultId }, orderBy: { createdAt: 'asc' } });
      return rows.map((t) => ({ id: t.id, name: text(t.name), keyVersion: t.keyVersion }));
    });

    app.post('/:vaultId/tags', async (request, reply) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'editor');
      const name = assertEnvelope((request.body as Record<string, unknown>)['name'], 'name');
      const vault = await prisma.vault.findUniqueOrThrow({ where: { id: vaultId } });
      const created = await prisma.tag.create({
        data: { vaultId, name: bytes(name), keyVersion: vault.keyVersion },
      });
      return reply.code(201).send({ id: created.id, keyVersion: created.keyVersion });
    });

    /**
     * Deleting a tag never touches the secrets carrying it. A tag is a label, not a container,
     * so removing it can only ever mean removing the label.
     */
    app.delete('/:vaultId/tags/:tagId', async (request, reply) => {
      const { vaultId, tagId } = request.params as { vaultId: string; tagId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'editor');
      const tag = await prisma.tag.findFirst({ where: { id: tagId, vaultId } });
      if (!tag) throw notFound();
      await prisma.tag.delete({ where: { id: tagId } });
      return reply.code(204).send();
    });

    /** Replaces the whole tag set for one secret. */
    app.put('/:vaultId/secrets/:secretId/tags', async (request) => {
      const { vaultId, secretId } = request.params as { vaultId: string; secretId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'editor');

      const tagIds = (request.body as { tagIds?: unknown }).tagIds;
      if (!Array.isArray(tagIds) || tagIds.some((t) => typeof t !== 'string')) {
        throw new ApiError('VALIDATION_FAILED', 'tagIds must be an array of ids');
      }

      const secret = await prisma.secret.findFirst({ where: { id: secretId, vaultId } });
      if (!secret) throw notFound();

      // Every tag must belong to THIS vault. Without this check a caller could attach a tag
      // from a vault they are a member of onto a secret in another, leaking its name.
      const valid = await prisma.tag.findMany({
        where: { vaultId, id: { in: tagIds as string[] } },
        select: { id: true },
      });
      if (valid.length !== tagIds.length) {
        throw new ApiError('VALIDATION_FAILED', 'One or more tags do not belong to this vault');
      }

      await prisma.$transaction(async (tx) => {
        await tx.secretTag.deleteMany({ where: { secretId } });
        if (valid.length > 0) {
          await tx.secretTag.createMany({
            data: valid.map((t) => ({ secretId, tagId: t.id })),
          });
        }
      });

      return { secretId, tagIds: valid.map((t) => t.id) };
    });
  };
}
