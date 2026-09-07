/**
 * Restore a vault from a backup (T130, FR-063).
 *
 * The restore lands as a NEW vault rather than overwriting an existing one. Overwriting would
 * make a mistaken restore destructive — and this product has no undo and no trash, so a
 * destructive mistake here is permanent. A new vault is always recoverable from: the user can
 * delete it.
 *
 * Every value arriving here is validated as a well-formed envelope before it is stored. The
 * server cannot tell ciphertext from a lie about ciphertext, but it CAN refuse anything that is
 * not shaped like an envelope, which stops a malformed or hostile file from planting readable
 * data in a database whose entire premise is that it holds none.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError, assertEnvelope, assertKeyWrap, base64UrlToBytes } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { record } from '../activity/record.js';

const bytes = (envelope: string): Buffer => Buffer.from(base64UrlToBytes(envelope));

interface IncomingSecret {
  templateVersionId: string;
  title: string;
  fieldValues: Record<string, string>;
  keyVersion: number;
  folderId: string | null;
  tagIds: string[];
}

function parseSecrets(raw: unknown): IncomingSecret[] {
  if (!Array.isArray(raw)) throw new ApiError('VALIDATION_FAILED', 'secrets must be an array');

  return raw.map((entry, index) => {
    const s = entry as Record<string, unknown>;
    const fieldValues: Record<string, string> = {};
    const values = s['fieldValues'];
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      throw new ApiError('VALIDATION_FAILED', `secrets[${index}].fieldValues must be an object`);
    }
    for (const [fieldId, value] of Object.entries(values as Record<string, unknown>)) {
      fieldValues[fieldId] = assertEnvelope(value, `secrets[${index}].fieldValues.${fieldId}`);
    }

    const templateVersionId = String(s['templateVersionId'] ?? '');
    if (!templateVersionId) {
      throw new ApiError('VALIDATION_FAILED', `secrets[${index}].templateVersionId is required`);
    }

    return {
      templateVersionId,
      title: assertEnvelope(s['title'], `secrets[${index}].title`),
      fieldValues,
      keyVersion: Number(s['keyVersion'] ?? 1),
      folderId: typeof s['folderId'] === 'string' ? s['folderId'] : null,
      tagIds: Array.isArray(s['tagIds']) ? (s['tagIds'] as string[]) : [],
    };
  });
}

function parseNamed(raw: unknown, label: string): Array<{ id: string; name: string; keyVersion: number }> {
  if (!Array.isArray(raw)) throw new ApiError('VALIDATION_FAILED', `${label} must be an array`);
  return raw.map((entry, index) => {
    const n = entry as Record<string, unknown>;
    return {
      id: String(n['id'] ?? ''),
      name: assertEnvelope(n['name'], `${label}[${index}].name`),
      keyVersion: Number(n['keyVersion'] ?? 1),
    };
  });
}

export function importRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    app.post('/import', async (request, reply) => {
      const userId = request.session!.userId;
      const body = request.body as Record<string, unknown>;

      const name = assertEnvelope(body['name'], 'name');
      const wrappedVaultKey = assertKeyWrap(body['wrappedVaultKey'], 'wrappedVaultKey');
      const secrets = parseSecrets(body['secrets']);
      const folders = parseNamed(body['folders'], 'folders');
      const tags = parseNamed(body['tags'], 'tags');

      // Template versions the backup carried. A backup taken from another account may reference
      // versions this account has never seen, so any that are missing are recreated — as rows,
      // which is the whole point of Principle V.
      const templates = Array.isArray(body['templates']) ? body['templates'] : [];

      const created = await prisma.$transaction(async (tx) => {
        const vault = await tx.vault.create({
          data: { ownerId: userId, name: bytes(name), kind: 'standard' },
        });
        const membership = await tx.vaultMembership.create({
          data: { vaultId: vault.id, userId, role: 'owner', status: 'active', acceptedAt: new Date() },
        });
        await tx.vaultKeyWrap.create({
          data: { membershipId: membership.id, keyVersion: 1, wrappedVaultKey: bytes(wrappedVaultKey) },
        });

        for (const template of templates as Array<Record<string, unknown>>) {
          const id = String(template['id'] ?? '');
          if (!id) continue;
          const existing = await tx.templateVersion.findUnique({ where: { id } });
          if (existing) continue;

          // Restored as a custom template owned by the importer: a built-in belongs to the
          // product, and claiming to be one would let a file inject a template every account
          // can see.
          const owned = await tx.template.create({ data: { kind: 'custom', ownerId: userId } });
          const version = await tx.templateVersion.create({
            data: {
              id,
              templateId: owned.id,
              version: Number(template['version'] ?? 1),
              name: String(template['name'] ?? 'Restored type'),
              fields: (template['fields'] ?? []) as never,
            },
          });
          await tx.template.update({
            where: { id: owned.id },
            data: { currentVersionId: version.id },
          });
        }

        // Ids are remapped, so a restore into an account that already holds the original vault
        // cannot collide with it.
        const folderIds = new Map<string, string>();
        for (const folder of folders) {
          const row = await tx.folder.create({
            data: { vaultId: vault.id, name: bytes(folder.name), keyVersion: folder.keyVersion },
          });
          folderIds.set(folder.id, row.id);
        }

        const tagIds = new Map<string, string>();
        for (const tag of tags) {
          const row = await tx.tag.create({
            data: { vaultId: vault.id, name: bytes(tag.name), keyVersion: tag.keyVersion },
          });
          tagIds.set(tag.id, row.id);
        }

        for (const secret of secrets) {
          const row = await tx.secret.create({
            data: {
              vaultId: vault.id,
              templateVersionId: secret.templateVersionId,
              title: bytes(secret.title),
              fieldValues: secret.fieldValues,
              keyVersion: secret.keyVersion,
              folderId: secret.folderId ? (folderIds.get(secret.folderId) ?? null) : null,
            },
          });
          const mapped = secret.tagIds.map((t) => tagIds.get(t)).filter((t): t is string => !!t);
          if (mapped.length > 0) {
            await tx.secretTag.createMany({
              data: mapped.map((tagId) => ({ secretId: row.id, tagId })),
            });
          }
        }

        await record(tx, {
          vaultId: vault.id,
          actorId: userId,
          action: 'vault_created',
          metadata: { restored: true, secrets: secrets.length },
        });

        return vault;
      });

      return reply.code(201).send({ id: created.id, secrets: secrets.length });
    });
  };
}
