/**
 * Secret routes.
 *
 * Every field carrying secret data arrives as an opaque envelope and is stored as bytes. There
 * is no code path here that decrypts, and none that could — the server holds no key.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError, assertEnvelope, base64UrlToBytes, bytesToBase64Url, notFound } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { requireMembership } from '../vaults/authz.js';

const bytes = (envelope: string): Buffer => Buffer.from(base64UrlToBytes(envelope));
const text = (column: Uint8Array): string => bytesToBase64Url(new Uint8Array(column));

/** Every value in the map must be a well-formed envelope; keys are template field ids. */
function assertFieldValues(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ApiError('VALIDATION_FAILED', 'fieldValues must be an object');
  }
  const out: Record<string, string> = {};
  for (const [fieldId, value] of Object.entries(raw as Record<string, unknown>)) {
    out[fieldId] = assertEnvelope(value, `fieldValues.${fieldId}`);
  }
  return out;
}

/**
 * Validates a tag set against the vault the secret lives in.
 *
 * Every tag must belong to THIS vault. Without the check, a member of two vaults could attach a
 * tag from one onto a secret in the other — and that tag's name is encrypted under a different
 * vault key, so it would surface on a secret whose readers cannot open it.
 */
async function resolveTagIds(
  prisma: PrismaClient,
  vaultId: string,
  raw: unknown,
): Promise<string[] | null> {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== 'string')) {
    throw new ApiError('VALIDATION_FAILED', 'tagIds must be an array of ids');
  }
  if (raw.length === 0) return [];
  const valid = await prisma.tag.findMany({
    where: { vaultId, id: { in: raw as string[] } },
    select: { id: true },
  });
  if (valid.length !== raw.length) {
    throw new ApiError('VALIDATION_FAILED', 'One or more tags do not belong to this vault');
  }
  return valid.map((t) => t.id);
}

export function secretRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /* ---------------- list ---------------- */
    app.get('/:vaultId/secrets', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId);

      const rows = await prisma.secret.findMany({
        where: { vaultId },
        include: { tags: true },
        orderBy: { updatedAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id,
        vaultId: row.vaultId,
        templateVersionId: row.templateVersionId,
        title: text(row.title),
        folderId: row.folderId,
        tagIds: row.tags.map((t) => t.tagId),
        fieldValues: row.fieldValues as Record<string, string>,
        keyVersion: row.keyVersion,
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
      }));
    });

    /* ---------------- read one ---------------- */
    app.get('/:vaultId/secrets/:secretId', async (request) => {
      const { vaultId, secretId } = request.params as { vaultId: string; secretId: string };
      await requireMembership(prisma, vaultId, request.session!.userId);

      const row = await prisma.secret.findFirst({ where: { id: secretId, vaultId }, include: { tags: true } });
      if (!row) throw notFound();
      return {
        id: row.id,
        vaultId: row.vaultId,
        templateVersionId: row.templateVersionId,
        title: text(row.title),
        folderId: row.folderId,
        tagIds: row.tags.map((t) => t.tagId),
        fieldValues: row.fieldValues as Record<string, string>,
        keyVersion: row.keyVersion,
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
      };
    });

    /* ---------------- create ---------------- */
    app.post('/:vaultId/secrets', async (request, reply) => {
      const { vaultId } = request.params as { vaultId: string };
      // Editor or above. A Viewer's write is refused HERE, regardless of what the UI offered.
      await requireMembership(prisma, vaultId, request.session!.userId, 'editor');

      const body = request.body as Record<string, unknown>;
      const title = assertEnvelope(body['title'], 'title');
      const fieldValues = assertFieldValues(body['fieldValues']);
      const templateVersionId = String(body['templateVersionId'] ?? '');
      if (!templateVersionId) throw new ApiError('VALIDATION_FAILED', 'templateVersionId is required');

      const vault = await prisma.vault.findUniqueOrThrow({ where: { id: vaultId } });
      // Resolved before the transaction so an invalid tag refuses the whole write rather than
      // leaving a secret stored with its tags silently dropped.
      const tagIds = await resolveTagIds(prisma, vaultId, body['tagIds']);

      const created = await prisma.$transaction(async (tx) => {
        const secret = await tx.secret.create({
          data: {
            vaultId,
            templateVersionId,
            title: bytes(title),
            folderId: (body['folderId'] as string | null) ?? null,
            fieldValues,
            // Writers always use the vault's highest generation, so a running rotation
            // never chases rows being written behind it.
            keyVersion: vault.keyVersion,
          },
        });
        if (tagIds && tagIds.length > 0) {
          await tx.secretTag.createMany({
            data: tagIds.map((tagId) => ({ secretId: secret.id, tagId })),
          });
        }
        return secret;
      });

      return reply.code(201).send({ id: created.id, revision: created.revision, keyVersion: created.keyVersion });
    });

    /* ---------------- update, with optimistic concurrency ---------------- */
    app.put('/:vaultId/secrets/:secretId', async (request) => {
      const { vaultId, secretId } = request.params as { vaultId: string; secretId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'editor');

      const body = request.body as Record<string, unknown>;
      const title = assertEnvelope(body['title'], 'title');
      const fieldValues = assertFieldValues(body['fieldValues']);
      const revision = Number(body['revision']);
      if (!Number.isInteger(revision)) {
        throw new ApiError('VALIDATION_FAILED', 'revision is required on update');
      }

      const current = await prisma.secret.findFirst({ where: { id: secretId, vaultId } });
      if (!current) throw notFound();

      // The second save must not silently discard the first (spec edge case).
      if (current.revision !== revision) {
        throw new ApiError('REVISION_CONFLICT', 'This secret changed since you loaded it', {
          current: {
            id: current.id,
            title: text(current.title),
            fieldValues: current.fieldValues as Record<string, string>,
            revision: current.revision,
            keyVersion: current.keyVersion,
            updatedAt: current.updatedAt.toISOString(),
          },
        });
      }

      const tagIds = await resolveTagIds(prisma, vaultId, body['tagIds']);

      const updated = await prisma.$transaction(async (tx) => {
        const secret = await tx.secret.update({
          where: { id: secretId },
          data: {
            title: bytes(title),
            fieldValues,
            folderId: (body['folderId'] as string | null) ?? null,
            revision: { increment: 1 },
          },
        });
        // Omitting tagIds leaves the existing set alone; sending one replaces it wholesale.
        if (tagIds !== null) {
          await tx.secretTag.deleteMany({ where: { secretId } });
          if (tagIds.length > 0) {
            await tx.secretTag.createMany({
              data: tagIds.map((tagId) => ({ secretId, tagId })),
            });
          }
        }
        return secret;
      });

      return { id: updated.id, revision: updated.revision };
    });

    /* ---------------- permanent deletion (FR-053, FR-076) ---------------- */
    app.delete('/:vaultId/secrets/:secretId', async (request, reply) => {
      const { vaultId, secretId } = request.params as { vaultId: string; secretId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'editor');

      const row = await prisma.secret.findFirst({ where: { id: secretId, vaultId } });
      if (!row) throw notFound();

      await prisma.$transaction(async (tx) => {
        // A real DELETE. No trash, no restore, no purge job.
        await tx.secret.delete({ where: { id: secretId } });
        // The log records the id and NOTHING else: the title is encrypted, and retaining its
        // ciphertext would be retaining a value the user just destroyed (FR-079).
        await tx.activityLogEntry.create({
          data: {
            vaultId,
            actorId: request.session!.userId,
            subjectId: secretId,
            action: 'secret_deleted',
          },
        });
      });
      return reply.code(204).send();
    });

    /* ---------------- the caller's vaults ---------------- */
    app.get('/', async (request) => {
      // Invited memberships are included, flagged: without them an invited member sees no
      // vault at all and has nothing to accept. They already hold the key wrap, so the vault's
      // name decrypts for them — which is what lets the invitation name what they were offered.
      const memberships = await prisma.vaultMembership.findMany({
        where: { userId: request.session!.userId, status: { in: ['active', 'invited'] } },
        include: { vault: true, keyWraps: true, },
      });

      const running = await prisma.vaultRotation.findMany({
        where: { vaultId: { in: memberships.map((m) => m.vaultId) }, state: 'running' },
        select: { vaultId: true },
      });
      const rotating = new Set(running.map((r) => r.vaultId));

      return memberships.map((m) => ({
        id: m.vault.id,
        name: text(m.vault.name),
        kind: m.vault.kind,
        keyVersion: m.vault.keyVersion,
        nameKeyVersion: m.vault.nameKeyVersion,
        role: m.role,
        status: m.status,
        rotationPending: rotating.has(m.vaultId),
        keyWraps: m.keyWraps.map((w) => ({
          keyVersion: w.keyVersion,
          wrappedVaultKey: text(w.wrappedVaultKey),
        })),
      }));
    });
  };
}
