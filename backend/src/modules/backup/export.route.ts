/**
 * Encrypted vault export (T129, FR-060 to FR-065).
 *
 * The server assembles the bundle out of rows it already holds, and every one of them is
 * ciphertext it cannot read. That is the whole design: export is a *copy*, not a decryption, so
 * there is no code path here that could produce a plaintext backup even if someone asked for
 * one (FR-061).
 *
 * What is deliberately NOT in the bundle: the master password, the AuthHash, any unwrapped key,
 * and any hint. The wrapped VaultKeys ARE included, because without them a restore would have
 * nothing to open the ciphertext with — and they are safe, since opening one still requires the
 * master password in force when the backup was taken (FR-062, FR-064).
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { bytesToBase64Url } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { requireMembership } from '../vaults/authz.js';
import { record } from '../activity/record.js';

const text = (column: Uint8Array): string => bytesToBase64Url(new Uint8Array(column));

export function exportRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    app.get('/:vaultId/export', async (request) => {
      const { vaultId } = request.params as { vaultId: string };
      const userId = request.session!.userId;

      // Owner only (FR-065). An Editor can already read every secret one at a time, but taking
      // the entire vault as a portable file is a different act with a different blast radius,
      // and it is the Owner's call.
      const membership = await requireMembership(prisma, vaultId, userId, 'owner');

      const [vault, secrets, folders, tags, keyWraps] = await Promise.all([
        prisma.vault.findUniqueOrThrow({ where: { id: vaultId } }),
        prisma.secret.findMany({ where: { vaultId }, include: { tags: true } }),
        prisma.folder.findMany({ where: { vaultId } }),
        prisma.tag.findMany({ where: { vaultId } }),
        prisma.vaultKeyWrap.findMany({
          where: { membershipId: membership.id },
          orderBy: { keyVersion: 'asc' },
        }),
      ]);

      // The template definitions the secrets were authored under — including superseded
      // versions. Without them a restored secret would have nothing to render its fields
      // (FR-060), which is the same data loss the versioning design exists to prevent.
      const templates = await prisma.templateVersion.findMany({
        where: { id: { in: [...new Set(secrets.map((s) => s.templateVersionId))] } },
        include: { template: true },
      });

      // Recorded for shared vaults (FR-065). A personal vault has no one else to inform, and a
      // log entry there would be noise rather than accountability.
      if (vault.kind !== 'personal') {
        await prisma.$transaction(async (tx) => {
          await record(tx, {
            vaultId,
            actorId: userId,
            action: 'exported',
            // Counts only. Anything identifying a secret would outlive the secret itself.
            metadata: { secrets: secrets.length, folders: folders.length, tags: tags.length },
          });
        });
      }

      return {
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        vault: { name: text(vault.name), kind: vault.kind, keyVersion: vault.keyVersion },
        keyWraps: keyWraps.map((w) => ({
          keyVersion: w.keyVersion,
          wrappedVaultKey: text(w.wrappedVaultKey),
        })),
        secrets: secrets.map((s) => ({
          id: s.id,
          templateVersionId: s.templateVersionId,
          title: text(s.title),
          fieldValues: s.fieldValues as Record<string, string>,
          folderId: s.folderId,
          tagIds: s.tags.map((t) => t.tagId),
          keyVersion: s.keyVersion,
        })),
        folders: folders.map((f) => ({ id: f.id, name: text(f.name), keyVersion: f.keyVersion })),
        tags: tags.map((t) => ({ id: t.id, name: text(t.name), keyVersion: t.keyVersion })),
        templates: templates.map((v) => ({
          id: v.id,
          templateId: v.templateId,
          version: v.version,
          name: v.name,
          kind: v.template.kind,
          fields: v.fields,
          createdAt: v.createdAt.toISOString(),
        })),
      };
    });
  };
}
