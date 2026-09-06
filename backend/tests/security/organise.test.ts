/**
 * Folders and tags (T067, T068, FR-046, FR-047, FR-048).
 *
 * The load-bearing case is folder deletion: FR-048 forbids a silent default, because cascading
 * destroys secrets and orphaning hides them, and neither is safe to guess on the user's behalf.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call, sessionCookie } from '../helpers/client.js';
import { login, registration } from '../helpers/enrol.js';
import { generateVaultKey } from '../../../frontend/src/crypto/vault-key.js';
import { encrypt } from '../../../frontend/src/crypto/envelope.js';

let db: TestDb;
let app: FastifyInstance;
let cookie: string;
let vaultId: string;
let templateVersionId: string;

const EMAIL = 'organise@example.com';
const PASSWORD = 'correct horse battery staple';

/** Any well-formed envelope works: the server stores opaque bytes and never opens one. */
const vaultKey = generateVaultKey();
const sealed = (value: string) => encrypt(vaultKey, value);

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);

  await call(app, 'POST', '/auth/register', { payload: await registration(EMAIL, PASSWORD) });
  cookie = sessionCookie(await call(app, 'POST', '/auth/login', { payload: await login(EMAIL, PASSWORD) }));

  const user = await db.prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, include: { ownedVaults: true } });
  vaultId = user.ownedVaults[0]!.id;

  // A minimal template: these tests exercise filing and tagging, not field rendering.
  const template = await db.prisma.template.create({ data: { kind: 'builtin', ownerId: null } });
  const version = await db.prisma.templateVersion.create({
    data: { templateId: template.id, version: 1, name: 'Website Account', fields: [] },
  });
  templateVersionId = version.id;
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

async function makeSecret(folderId?: string): Promise<string> {
  const res = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
    cookie,
    payload: {
      templateVersionId,
      title: await sealed('a secret'),
      fieldValues: { username: await sealed('someone') },
      keyVersion: 1,
      ...(folderId ? { folderId } : {}),
    },
  });
  expect(res.status).toBe(201);
  return res.body['id'] as string;
}

async function makeFolder(name: string): Promise<string> {
  const res = await call(app, 'POST', `/vaults/${vaultId}/folders`, {
    cookie,
    payload: { name: await sealed(name) },
  });
  expect(res.status).toBe(201);
  return res.body['id'] as string;
}

async function makeTag(name: string): Promise<string> {
  const res = await call(app, 'POST', `/vaults/${vaultId}/tags`, {
    cookie,
    payload: { name: await sealed(name) },
  });
  expect(res.status).toBe(201);
  return res.body['id'] as string;
}

describe('folders', () => {
  it('stores the name as opaque ciphertext, never as text', async () => {
    const id = await makeFolder('Divorce Lawyer');
    const row = await db.prisma.folder.findUniqueOrThrow({ where: { id } });
    expect(Buffer.from(row.name).toString('utf8')).not.toContain('Divorce');
    // First two bytes are the envelope version and algorithm.
    expect(Buffer.from(row.name)[0]).toBe(0x01);
  });

  it('records the vault generation, so a rotation can tell it is outstanding', async () => {
    const id = await makeFolder('Finance');
    const row = await db.prisma.folder.findUniqueOrThrow({ where: { id } });
    expect(row.keyVersion).toBe(1);
  });

  it('rejects a name that is not a well-formed envelope', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/folders`, {
      cookie,
      payload: { name: 'Finance' },
    });
    expect(res.status).toBe(400);
    expect(res.body['error']).toMatchObject({ code: 'ENVELOPE_MALFORMED' });
  });
});

describe('folder deletion requires an explicit disposition (FR-048)', () => {
  it('refuses with no disposition, and says what the choices mean', async () => {
    const folderId = await makeFolder('Doomed');
    const res = await call(app, 'DELETE', `/vaults/${vaultId}/folders/${folderId}`, { cookie });

    expect(res.status).toBe(400);
    expect(String(res.body['error'] && (res.body['error'] as { message: string }).message)).toMatch(/orphan/);
    // The folder must still be there — a refused delete may not half-happen.
    expect(await db.prisma.folder.findUnique({ where: { id: folderId } })).not.toBeNull();
  });

  it('refuses an unrecognised disposition rather than guessing', async () => {
    const folderId = await makeFolder('Doomed 2');
    const res = await call(app, 'DELETE', `/vaults/${vaultId}/folders/${folderId}?disposition=maybe`, { cookie });
    expect(res.status).toBe(400);
    expect(await db.prisma.folder.findUnique({ where: { id: folderId } })).not.toBeNull();
  });

  it('orphan: keeps every secret, unfiled', async () => {
    const folderId = await makeFolder('Keep contents');
    const secretId = await makeSecret(folderId);

    const res = await call(app, 'DELETE', `/vaults/${vaultId}/folders/${folderId}?disposition=orphan`, { cookie });
    expect(res.status).toBe(204);

    const secret = await db.prisma.secret.findUnique({ where: { id: secretId } });
    expect(secret).not.toBeNull();
    expect(secret!.folderId).toBeNull();
    expect(await db.prisma.folder.findUnique({ where: { id: folderId } })).toBeNull();
  });

  it('cascade: deletes the secrets and logs each one without its title', async () => {
    const folderId = await makeFolder('Delete contents');
    const secretId = await makeSecret(folderId);

    const res = await call(app, 'DELETE', `/vaults/${vaultId}/folders/${folderId}?disposition=cascade`, { cookie });
    expect(res.status).toBe(204);

    expect(await db.prisma.secret.findUnique({ where: { id: secretId } })).toBeNull();

    const logged = await db.prisma.activityLogEntry.findMany({
      where: { action: 'secret_deleted', subjectId: secretId },
    });
    expect(logged).toHaveLength(1);
    // FR-079: the id and nothing else. The title was encrypted and is gone with the row.
    expect(logged[0]!.metadata).toBeNull();
  });

  it('leaves secrets in other folders alone', async () => {
    const doomed = await makeFolder('Doomed folder');
    const safe = await makeFolder('Safe folder');
    const doomedSecret = await makeSecret(doomed);
    const safeSecret = await makeSecret(safe);

    await call(app, 'DELETE', `/vaults/${vaultId}/folders/${doomed}?disposition=cascade`, { cookie });

    expect(await db.prisma.secret.findUnique({ where: { id: doomedSecret } })).toBeNull();
    expect(await db.prisma.secret.findUnique({ where: { id: safeSecret } })).not.toBeNull();
  });
});

describe('tags', () => {
  it('attaches and replaces a secret’s tag set', async () => {
    const secretId = await makeSecret();
    const a = await makeTag('urgent');
    const b = await makeTag('personal');

    const first = await call(app, 'PUT', `/vaults/${vaultId}/secrets/${secretId}/tags`, {
      cookie,
      payload: { tagIds: [a, b] },
    });
    expect(first.status).toBe(200);
    expect(await db.prisma.secretTag.count({ where: { secretId } })).toBe(2);

    // A PUT replaces rather than appends.
    const second = await call(app, 'PUT', `/vaults/${vaultId}/secrets/${secretId}/tags`, {
      cookie,
      payload: { tagIds: [a] },
    });
    expect(second.status).toBe(200);
    expect(await db.prisma.secretTag.count({ where: { secretId } })).toBe(1);
  });

  it('deleting a tag removes the label but never the secrets carrying it', async () => {
    const secretId = await makeSecret();
    const tagId = await makeTag('doomed-tag');
    await call(app, 'PUT', `/vaults/${vaultId}/secrets/${secretId}/tags`, { cookie, payload: { tagIds: [tagId] } });

    const res = await call(app, 'DELETE', `/vaults/${vaultId}/tags/${tagId}`, { cookie });
    expect(res.status).toBe(204);

    expect(await db.prisma.secret.findUnique({ where: { id: secretId } })).not.toBeNull();
    expect(await db.prisma.secretTag.count({ where: { secretId } })).toBe(0);
  });

  /**
   * Without this check a member of two vaults could attach a tag from one onto a secret in the
   * other, and the tag's name — which is encrypted under a DIFFERENT vault key — would surface
   * on a secret whose readers cannot open it.
   */
  it('refuses a tag belonging to a different vault', async () => {
    const secretId = await makeSecret();

    const otherVault = await db.prisma.vault.create({
      data: {
        ownerId: (await db.prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).id,
        name: Buffer.from('x'),
        kind: 'standard',
      },
    });
    const foreignTag = await db.prisma.tag.create({
      data: { vaultId: otherVault.id, name: Buffer.from('y'), keyVersion: 1 },
    });

    const res = await call(app, 'PUT', `/vaults/${vaultId}/secrets/${secretId}/tags`, {
      cookie,
      payload: { tagIds: [foreignTag.id] },
    });
    expect(res.status).toBe(400);
    expect(await db.prisma.secretTag.count({ where: { secretId } })).toBe(0);
  });
});

describe('filing at creation time', () => {
  it('stores folder and tags in the same write as the secret', async () => {
    const folderId = await makeFolder('At creation');
    const a = await makeTag('created-with-a');
    const b = await makeTag('created-with-b');

    const res = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
      cookie,
      payload: {
        templateVersionId,
        title: await sealed('filed on arrival'),
        fieldValues: {},
        keyVersion: 1,
        folderId,
        tagIds: [a, b],
      },
    });
    expect(res.status).toBe(201);

    const secretId = res.body['id'] as string;
    const row = await db.prisma.secret.findUniqueOrThrow({
      where: { id: secretId },
      include: { tags: true },
    });
    expect(row.folderId).toBe(folderId);
    expect(row.tags.map((t) => t.tagId).sort()).toEqual([a, b].sort());
  });

  /**
   * The reason tags are accepted on the write itself rather than through a second request:
   * a bad tag must refuse the whole thing, not leave a stored secret with its tags dropped.
   */
  it('refuses the entire write when a tag is invalid — no orphaned secret', async () => {
    const before = await db.prisma.secret.count({ where: { vaultId } });

    const res = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
      cookie,
      payload: {
        templateVersionId,
        title: await sealed('should not exist'),
        fieldValues: {},
        keyVersion: 1,
        tagIds: ['00000000-0000-0000-0000-000000000000'],
      },
    });
    expect(res.status).toBe(400);
    expect(await db.prisma.secret.count({ where: { vaultId } })).toBe(before);
  });

  it('replaces the tag set on edit, and leaves it alone when tagIds is omitted', async () => {
    const a = await makeTag('edit-a');
    const b = await makeTag('edit-b');
    const created = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
      cookie,
      payload: {
        templateVersionId,
        title: await sealed('editable'),
        fieldValues: {},
        keyVersion: 1,
        tagIds: [a, b],
      },
    });
    const secretId = created.body['id'] as string;
    const revision = created.body['revision'] as number;

    // Sending a set replaces it.
    const replaced = await call(app, 'PUT', `/vaults/${vaultId}/secrets/${secretId}`, {
      cookie,
      payload: {
        templateVersionId,
        title: await sealed('editable'),
        fieldValues: {},
        keyVersion: 1,
        tagIds: [a],
        revision,
      },
    });
    expect(replaced.status).toBe(200);
    expect(await db.prisma.secretTag.count({ where: { secretId } })).toBe(1);

    // Omitting it leaves the set untouched.
    const untouched = await call(app, 'PUT', `/vaults/${vaultId}/secrets/${secretId}`, {
      cookie,
      payload: {
        templateVersionId,
        title: await sealed('editable again'),
        fieldValues: {},
        keyVersion: 1,
        revision: replaced.body['revision'] as number,
      },
    });
    expect(untouched.status).toBe(200);
    expect(await db.prisma.secretTag.count({ where: { secretId } })).toBe(1);
  });
});

describe('authorization', () => {
  it('refuses folder and tag reads without a session', async () => {
    expect((await call(app, 'GET', `/vaults/${vaultId}/folders`)).status).toBe(401);
    expect((await call(app, 'GET', `/vaults/${vaultId}/tags`)).status).toBe(401);
  });

  it('returns NOT_FOUND for a vault the caller is not a member of, not FORBIDDEN', async () => {
    await call(app, 'POST', '/auth/register', { payload: await registration('outsider@example.com', PASSWORD) });
    const outsider = sessionCookie(
      await call(app, 'POST', '/auth/login', { payload: await login('outsider@example.com', PASSWORD) }),
    );
    const res = await call(app, 'GET', `/vaults/${vaultId}/folders`, { cookie: outsider });
    // 404, not 403 — a 403 would confirm the vault exists (FR-030).
    expect(res.status).toBe(404);
  });
});
