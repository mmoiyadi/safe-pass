/**
 * Resumable key rotation (T090, T091, T092, T094).
 *
 * A vault mid-rotation holds TWO live generations, and every remaining member holds a wrap for
 * both. That is what makes FR-082 and FR-083 compatible: the vault stays fully readable while
 * being re-encrypted, and an interrupted job leaves it consistent rather than half-open.
 *
 * The close precondition is the safety property. Everything encrypted under the vault key must
 * be rewritten first — secrets, folder names, tag names, AND the vault's own name. Closing on
 * the secrets alone would delete the old generation's wraps while the other three still needed
 * them, and nothing would report an error: those names would simply never open again.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError, assertEnvelope, assertKeyWrap, base64UrlToBytes, notFound } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { requireMembership } from './authz.js';
import { record } from '../activity/record.js';

const bytes = (envelope: string): Buffer => Buffer.from(base64UrlToBytes(envelope));

interface RotationView {
  id: string;
  vaultId: string;
  fromVersion: number;
  toVersion: number;
  state: string;
  cursor: string | null;
  totalCount: number;
  doneCount: number;
  startedAt: string;
}

/** Counts everything still encrypted under the old generation. All four kinds. */
async function outstanding(
  prisma: PrismaClient,
  vaultId: string,
  fromVersion: number,
): Promise<{ secrets: number; folders: number; tags: number; vaultName: number; total: number }> {
  const [secrets, folders, tags, vault] = await Promise.all([
    prisma.secret.count({ where: { vaultId, keyVersion: fromVersion } }),
    prisma.folder.count({ where: { vaultId, keyVersion: fromVersion } }),
    prisma.tag.count({ where: { vaultId, keyVersion: fromVersion } }),
    prisma.vault.findUniqueOrThrow({ where: { id: vaultId } }),
  ]);
  const vaultName = vault.nameKeyVersion === fromVersion ? 1 : 0;
  return { secrets, folders, tags, vaultName, total: secrets + folders + tags + vaultName };
}

export function rotationRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /* ------------------------------ progress ------------------------------ */
    app.get('/:vaultId/rotation', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId);

      const rotation = await prisma.vaultRotation.findFirst({
        where: { vaultId, state: 'running' },
      });
      if (!rotation) throw notFound();
      return view(rotation);
    });

    /* -------------------------------- open -------------------------------- */
    app.post('/:vaultId/rotation', async (request, reply) => {
      const { vaultId } = request.params as { vaultId: string };
      const actorId = request.session!.userId;
      await requireMembership(prisma, vaultId, actorId, 'owner');

      const body = request.body as Record<string, unknown>;
      const toVersion = Number(body['toVersion']);
      const memberKeys = (body['memberKeys'] ?? []) as Array<{ userId?: unknown; wrappedVaultKey?: unknown }>;
      if (!Array.isArray(memberKeys)) {
        throw new ApiError('VALIDATION_FAILED', 'memberKeys must be an array');
      }

      const running = await prisma.vaultRotation.findFirst({ where: { vaultId, state: 'running' } });
      if (running) {
        throw new ApiError(
          'ROTATION_IN_PROGRESS',
          'A rotation is already open. Two generations is the maximum a vault may hold at once.',
        );
      }

      const vault = await prisma.vault.findUniqueOrThrow({ where: { id: vaultId } });
      if (toVersion !== vault.keyVersion + 1) {
        throw new ApiError('KEY_VERSION_STALE', `The next generation is ${vault.keyVersion + 1}`);
      }

      // Every remaining active or invited member must receive a wrap of the new key, or the
      // rotation would lock them out the moment it closes.
      const members = await prisma.vaultMembership.findMany({
        where: { vaultId, status: { in: ['active', 'invited'] } },
      });
      const supplied = new Set(memberKeys.map((k) => String(k.userId)));
      const missing = members.filter((m) => !supplied.has(m.userId));
      if (missing.length > 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'Every remaining member needs a wrap of the new key; without one they lose access when the rotation closes',
          { missing: missing.length },
        );
      }

      const total = await outstanding(prisma, vaultId, vault.keyVersion);

      const rotation = await prisma.$transaction(async (tx) => {
        const created = await tx.vaultRotation.create({
          data: {
            vaultId,
            fromVersion: vault.keyVersion,
            toVersion,
            state: 'running',
            startedById: actorId,
            totalCount: total.total,
          },
        });

        for (const key of memberKeys) {
          const membership = members.find((m) => m.userId === String(key.userId));
          if (!membership) continue;
          await tx.vaultKeyWrap.create({
            data: {
              membershipId: membership.id,
              keyVersion: toVersion,
              wrappedVaultKey: bytes(assertKeyWrap(key.wrappedVaultKey, 'wrappedVaultKey')),
            },
          });
        }

        // The vault advances to the new generation so WRITES land there immediately; existing
        // rows lag behind until the batches reach them.
        await tx.vault.update({ where: { id: vaultId }, data: { keyVersion: toVersion } });

        await record(tx, {
          vaultId,
          actorId,
          action: 'rotation_started',
          metadata: { from: created.fromVersion, to: toVersion, items: total.total },
        });
        return created;
      });

      return reply.code(201).send(view(rotation));
    });

    /* -------------------------------- batch ------------------------------- */
    app.post('/:vaultId/rotation/batch', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      await requireMembership(prisma, vaultId, request.session!.userId, 'owner');

      const rotation = await prisma.vaultRotation.findFirst({ where: { vaultId, state: 'running' } });
      if (!rotation) throw notFound();

      const body = request.body as Record<string, unknown>;
      if (Number(body['toVersion']) !== rotation.toVersion) {
        throw new ApiError('KEY_VERSION_STALE', 'Re-read the rotation and resume from its cursor');
      }

      const secrets = (body['secrets'] ?? []) as Array<Record<string, unknown>>;
      const folders = (body['folders'] ?? []) as Array<Record<string, unknown>>;
      const tags = (body['tags'] ?? []) as Array<Record<string, unknown>>;
      const vaultName = body['vaultName'];

      if (secrets.length === 0 && folders.length === 0 && tags.length === 0 && vaultName === undefined) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'A batch must carry at least one of secrets, folders, tags, or vaultName',
        );
      }

      // One transaction per batch: a crash resumes from the cursor rather than rolling the
      // whole rotation back.
      const updated = await prisma.$transaction(async (tx) => {
        let done = 0;
        let cursor = rotation.cursor;

        for (const row of secrets) {
          const id = String(row['id']);
          const fieldValues = row['fieldValues'] ?? {};
          await tx.secret.update({
            where: { id },
            data: {
              title: bytes(assertEnvelope(row['title'], 'title')),
              fieldValues: fieldValues as object,
              keyVersion: rotation.toVersion,
            },
          });
          cursor = id;
          done++;
        }

        for (const row of folders) {
          await tx.folder.update({
            where: { id: String(row['id']) },
            data: { name: bytes(assertEnvelope(row['name'], 'name')), keyVersion: rotation.toVersion },
          });
          done++;
        }

        for (const row of tags) {
          await tx.tag.update({
            where: { id: String(row['id']) },
            data: { name: bytes(assertEnvelope(row['name'], 'name')), keyVersion: rotation.toVersion },
          });
          done++;
        }

        if (vaultName !== undefined) {
          await tx.vault.update({
            where: { id: vaultId },
            data: {
              name: bytes(assertEnvelope(vaultName, 'vaultName')),
              nameKeyVersion: rotation.toVersion,
            },
          });
          done++;
        }

        return tx.vaultRotation.update({
          where: { id: rotation.id },
          data: { cursor, doneCount: { increment: done } },
        });
      });

      return view(updated);
    });

    /* -------------------------------- close ------------------------------- */
    app.post('/:vaultId/rotation/close', async (request, reply) => {
      const { vaultId } = request.params as { vaultId: string };
      const actorId = request.session!.userId;
      await requireMembership(prisma, vaultId, actorId, 'owner');

      const rotation = await prisma.vaultRotation.findFirst({ where: { vaultId, state: 'running' } });
      if (!rotation) throw notFound();

      // THE safety check. All four, not just the secrets.
      const remaining = await outstanding(prisma, vaultId, rotation.fromVersion);
      if (remaining.total > 0) {
        throw new ApiError(
          'ROTATION_IN_PROGRESS',
          'Cannot close: items are still encrypted under the previous key. Closing now would ' +
            'delete the only key that opens them.',
          {
            secrets: remaining.secrets,
            folders: remaining.folders,
            tags: remaining.tags,
            vaultName: remaining.vaultName,
          },
        );
      }

      await prisma.$transaction(async (tx) => {
        const memberships = await tx.vaultMembership.findMany({ where: { vaultId }, select: { id: true } });
        // The moment the revoked member's copy of the old key stops opening anything (FR-084).
        await tx.vaultKeyWrap.deleteMany({
          where: { keyVersion: rotation.fromVersion, membershipId: { in: memberships.map((m) => m.id) } },
        });
        await tx.vaultRotation.update({
          where: { id: rotation.id },
          data: { state: 'completed', completedAt: new Date() },
        });
        await record(tx, {
          vaultId,
          actorId,
          action: 'rotation_completed',
          metadata: { from: rotation.fromVersion, to: rotation.toVersion },
        });
      });

      return reply.code(204).send();
    });
  };
}

function view(rotation: {
  id: string;
  vaultId: string;
  fromVersion: number;
  toVersion: number;
  state: string;
  cursor: string | null;
  totalCount: number;
  doneCount: number;
  startedAt: Date;
}): RotationView {
  return {
    id: rotation.id,
    vaultId: rotation.vaultId,
    fromVersion: rotation.fromVersion,
    toVersion: rotation.toVersion,
    state: rotation.state,
    cursor: rotation.cursor,
    totalCount: rotation.totalCount,
    doneCount: rotation.doneCount,
    startedAt: rotation.startedAt.toISOString(),
  };
}
