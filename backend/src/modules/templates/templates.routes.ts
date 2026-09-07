/**
 * Custom templates (T116, T117, FR-038 to FR-043).
 *
 * A template is data. Adding a secret type is an INSERT, never a migration and never a deploy —
 * that is Constitution Principle V, and tests/integration/no-migration.test.ts asserts it by
 * comparing `prisma migrate status` before and after creating one.
 *
 * Editing creates a NEW version rather than mutating the old one, because secrets already
 * written point at the version they were authored under. Mutating in place would silently
 * change the meaning of stored data — a field renamed from "Code" to "PIN" would relabel every
 * existing secret, and a field removed would strand its values with nothing to render them.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ApiError, notFound } from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';

const FIELD_TYPES = new Set([
  'text',
  'password',
  'email',
  'url',
  'number',
  'date',
  'totp',
  'multiline',
]);

interface Field {
  id: string;
  label: string;
  type: string;
  required: boolean;
  sensitive: boolean;
  order: number;
  /** Prisma's Json input type wants an index signature; the shape above is the real contract. */
  [key: string]: string | number | boolean;
}

/**
 * Validates a field list.
 *
 * Duplicate labels are refused (FR-043) because two identically-labelled fields are
 * indistinguishable to the person filling the form. Duplicate ids are refused because the id is
 * the key in the stored value map — a collision would silently overwrite one value with the
 * other.
 */
function parseFields(raw: unknown): Field[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'A template needs at least one field');
  }

  const fields: Field[] = [];
  for (const [index, item] of raw.entries()) {
    const f = item as Record<string, unknown>;
    const id = String(f['id'] ?? '').trim();
    const label = String(f['label'] ?? '').trim();
    const type = String(f['type'] ?? '');

    if (!id || !label) throw new ApiError('VALIDATION_FAILED', 'Every field needs an id and a label');
    if (!FIELD_TYPES.has(type)) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `Unknown field type "${type}". A template that cannot be rendered is worse than no template.`,
      );
    }

    fields.push({
      id,
      label,
      type,
      required: f['required'] === true,
      sensitive: f['sensitive'] === true,
      order: typeof f['order'] === 'number' ? f['order'] : index,
    });
  }

  const labels = fields.map((f) => f.label.toLowerCase());
  if (new Set(labels).size !== labels.length) {
    throw new ApiError('TEMPLATE_FIELD_DUPLICATE', 'Two fields cannot share a label');
  }
  const ids = fields.map((f) => f.id);
  if (new Set(ids).size !== ids.length) {
    throw new ApiError('TEMPLATE_FIELD_DUPLICATE', 'Two fields cannot share an id');
  }

  return fields.sort((a, b) => a.order - b.order);
}

/** A custom template the caller owns. Built-ins and other people's are simply not found. */
async function requireOwnTemplate(prisma: PrismaClient, templateId: string, userId: string) {
  const template = await prisma.template.findFirst({
    where: { id: templateId, ownerId: userId, kind: 'custom' },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!template) throw notFound();
  return template;
}

export function templateRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /* -------------------------------- list -------------------------------- */
    app.get('/', async (request) => {
      const userId = request.session!.userId;
      const versions = await prisma.templateVersion.findMany({
        where: {
          template: { OR: [{ kind: 'builtin' }, { ownerId: userId }] },
          // The current version of each template; older ones stay readable via their secrets.
          id: { in: (await currentVersionIds(prisma, userId)) },
        },
        orderBy: { name: 'asc' },
        include: { template: true },
      });
      return versions.map((v) => ({
        id: v.id,
        templateId: v.templateId,
        version: v.version,
        name: v.name,
        fields: v.fields,
        kind: v.template.kind,
        createdAt: v.createdAt.toISOString(),
      }));
    });

    /* --------------------------- resolve a version ------------------------ */
    /**
     * One specific version, by id.
     *
     * The list route returns only current versions, which is right for "what can I create?" but
     * leaves a hole: a secret written under v1 of a template that has since moved to v2 has no
     * definition to render from, so it would show as an unknown type and could not be edited.
     * FR-040 promises exactly the opposite, so the client resolves the older version here.
     *
     * Visible if it is built in, if the caller owns the template, or if some secret in a vault
     * the caller actively belongs to was written under it — that last case covers a shared
     * vault whose secrets use a template belonging to another member.
     */
    app.get('/versions/:versionId', async (request) => {
      const userId = request.session!.userId;
      const { versionId } = request.params as { versionId: string };

      const version = await prisma.templateVersion.findUnique({
        where: { id: versionId },
        include: { template: true },
      });
      if (!version) throw notFound();

      const own = version.template.kind === 'builtin' || version.template.ownerId === userId;
      if (!own) {
        const memberships = await prisma.vaultMembership.findMany({
          where: { userId, status: 'active' },
          select: { vaultId: true },
        });
        const used = await prisma.secret.count({
          where: { templateVersionId: versionId, vaultId: { in: memberships.map((m) => m.vaultId) } },
        });
        // Not visible and not in use by anything the caller can see: indistinguishable from
        // a version that does not exist, and should stay that way.
        if (used === 0) throw notFound();
      }

      return {
        id: version.id,
        templateId: version.templateId,
        version: version.version,
        name: version.name,
        fields: version.fields,
        kind: version.template.kind,
        createdAt: version.createdAt.toISOString(),
      };
    });

    /* ------------------------------- create ------------------------------- */
    app.post('/', async (request, reply) => {
      const userId = request.session!.userId;
      const body = request.body as Record<string, unknown>;
      const name = String(body['name'] ?? '').trim();
      if (!name) throw new ApiError('VALIDATION_FAILED', 'A template needs a name');
      const fields = parseFields(body['fields']);

      const created = await prisma.$transaction(async (tx) => {
        const template = await tx.template.create({ data: { kind: 'custom', ownerId: userId } });
        const version = await tx.templateVersion.create({
          data: { templateId: template.id, version: 1, name, fields },
        });
        await tx.template.update({
          where: { id: template.id },
          data: { currentVersionId: version.id },
        });
        return { template, version };
      });

      return reply.code(201).send({
        templateId: created.template.id,
        versionId: created.version.id,
        version: created.version.version,
      });
    });

    /* -------------------------------- edit -------------------------------- */
    /**
     * Creates the next version. The previous one is never modified, so every secret already
     * written under it keeps rendering exactly as it was authored (FR-040).
     */
    app.put('/:templateId', async (request, reply) => {
      const userId = request.session!.userId;
      const { templateId } = request.params as { templateId: string };
      const template = await requireOwnTemplate(prisma, templateId, userId);

      const body = request.body as Record<string, unknown>;
      const name = String(body['name'] ?? '').trim();
      if (!name) throw new ApiError('VALIDATION_FAILED', 'A template needs a name');
      const fields = parseFields(body['fields']);

      const nextNumber = (template.versions[0]?.version ?? 0) + 1;

      const version = await prisma.$transaction(async (tx) => {
        const created = await tx.templateVersion.create({
          data: { templateId, version: nextNumber, name, fields },
        });
        await tx.template.update({ where: { id: templateId }, data: { currentVersionId: created.id } });
        return created;
      });

      return reply.code(201).send({ templateId, versionId: version.id, version: version.version });
    });

    /* ------------------------------- impact ------------------------------- */
    /**
     * What a proposed change would cost, so the interface can warn before it happens (FR-042).
     *
     * Removing a field does not delete anything — the values stay in the JSONB — but nothing
     * would render them, which amounts to losing them from the user's point of view. Saying so
     * beforehand is the difference between an informed choice and a surprise.
     */
    app.post('/:templateId/impact', async (request) => {
      const userId = request.session!.userId;
      const { templateId } = request.params as { templateId: string };
      const template = await requireOwnTemplate(prisma, templateId, userId);

      const proposed = parseFields((request.body as Record<string, unknown>)['fields']);
      const proposedIds = new Set(proposed.map((f) => f.id));

      // Every field this template has ever had, across all versions: a secret written under an
      // older version may carry a field the current one already dropped.
      const versions = await prisma.templateVersion.findMany({ where: { templateId } });
      const known = new Set<string>();
      for (const version of versions) {
        for (const field of version.fields as Field[]) known.add(field.id);
      }

      const removedFields = [...known].filter((id) => !proposedIds.has(id));

      let affectedSecrets = 0;
      if (removedFields.length > 0) {
        const secrets = await prisma.secret.findMany({
          where: { templateVersionId: { in: versions.map((v) => v.id) } },
          select: { fieldValues: true },
        });
        affectedSecrets = secrets.filter((s) => {
          const values = s.fieldValues as Record<string, unknown>;
          return removedFields.some((id) => values[id] !== undefined && values[id] !== '');
        }).length;
      }

      void template;
      return { removedFields, affectedSecrets };
    });

    /* ------------------------------- delete ------------------------------- */
    app.delete('/:templateId', async (request, reply) => {
      const userId = request.session!.userId;
      const { templateId } = request.params as { templateId: string };
      await requireOwnTemplate(prisma, templateId, userId);

      const inUse = await prisma.secret.count({
        where: { templateVersion: { templateId } },
      });
      if (inUse > 0) {
        throw new ApiError(
          'TEMPLATE_FIELD_IN_USE',
          `${inUse} secret${inUse === 1 ? '' : 's'} still use this template. Deleting it would ` +
            'leave them with nothing to render their fields.',
          { secrets: inUse },
        );
      }

      await prisma.template.delete({ where: { id: templateId } });
      return reply.code(204).send();
    });
  };
}

/** Current version of every template visible to this user. */
async function currentVersionIds(prisma: PrismaClient, userId: string): Promise<string[]> {
  const templates = await prisma.template.findMany({
    where: { OR: [{ kind: 'builtin' }, { ownerId: userId }] },
    select: { currentVersionId: true },
  });
  return templates
    .map((t) => t.currentVersionId)
    .filter((id): id is string => id !== null);
}
