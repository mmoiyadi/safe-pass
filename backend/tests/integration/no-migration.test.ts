/**
 * Adding a secret type is data, not a deploy (T121, Constitution Principle V, FR-039, FR-040).
 *
 * This is the test the principle exists for. If defining a new secret type ever needs a schema
 * change, the whole "templates are rows" design has quietly failed and nobody would notice —
 * the feature would still work, it would just need a migration and a release every time a user
 * wanted a new field.
 *
 * So: create a custom template with fields no built-in has, store a secret under it, read it
 * back, and assert the migration state is byte-identical throughout.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call, sessionCookie } from '../helpers/client.js';
import { login, registration } from '../helpers/enrol.js';
import { generateVaultKey } from '../../../frontend/src/crypto/vault-key.js';
import { decrypt, encrypt } from '../../../frontend/src/crypto/envelope.js';

const BACKEND = fileURLToPath(new URL('../../', import.meta.url));

let db: TestDb;
let app: FastifyInstance;
let cookie: string;
let vaultId: string;

const EMAIL = 'templates@example.com';
const PASSWORD = 'correct horse battery staple';
const vaultKey = generateVaultKey();

/** The exact migration state, as Prisma reports it. */
function migrationState(): string {
  try {
    return execFileSync(
      'pnpm',
      ['exec', 'prisma', 'migrate', 'status', '--schema', 'src/db/schema.prisma'],
      { cwd: BACKEND, env: { ...process.env, DATABASE_URL: db.url }, encoding: 'utf8' },
    );
  } catch (error) {
    // `migrate status` exits non-zero when anything is pending, which is itself the answer.
    return String((error as { stdout?: string }).stdout ?? error);
  }
}

const appliedCount = (status: string): string =>
  status.match(/(\d+) migrations? found/)?.[1] ?? 'unknown';

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
  await call(app, 'POST', '/auth/register', { payload: await registration(EMAIL, PASSWORD) });
  cookie = sessionCookie(await call(app, 'POST', '/auth/login', { payload: await login(EMAIL, PASSWORD) }));

  const user = await db.prisma.user.findUniqueOrThrow({
    where: { email: EMAIL },
    include: { ownedVaults: true },
  });
  vaultId = user.ownedVaults[0]!.id;
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('a new secret type needs no schema change (Principle V)', () => {
  let before: string;
  let templateVersionId: string;
  let secretId: string;

  it('starts from a clean, fully-applied migration state', () => {
    before = migrationState();
    expect(before).toMatch(/up to date/i);
  });

  it('defines a template with field types and shapes no built-in has', async () => {
    const res = await call(app, 'POST', '/templates', {
      cookie,
      payload: {
        name: 'Server SSH Access',
        fields: [
          { id: 'host', label: 'Hostname', type: 'text', required: true, sensitive: false, order: 0 },
          { id: 'port', label: 'Port', type: 'number', required: false, sensitive: false, order: 1 },
          { id: 'user', label: 'Login', type: 'text', required: true, sensitive: false, order: 2 },
          { id: 'key', label: 'Private key', type: 'multiline', required: true, sensitive: true, order: 3 },
          { id: 'passphrase', label: 'Key passphrase', type: 'password', required: false, sensitive: true, order: 4 },
          { id: 'expires', label: 'Rotate before', type: 'date', required: false, sensitive: false, order: 5 },
        ],
      },
    });
    expect(res.status).toBe(201);
    templateVersionId = res.body['versionId'] as string;
  });

  it('stores a secret under it, with fields no column exists for', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
      cookie,
      payload: {
        templateVersionId,
        title: await encrypt(vaultKey, 'prod-db-01'),
        fieldValues: {
          host: await encrypt(vaultKey, 'db01.internal'),
          port: await encrypt(vaultKey, '22'),
          user: await encrypt(vaultKey, 'deploy'),
          key: await encrypt(vaultKey, '-----BEGIN OPENSSH PRIVATE KEY-----\nnot a real key\n'),
          passphrase: await encrypt(vaultKey, 'a passphrase'),
          expires: await encrypt(vaultKey, '2027-01-01'),
        },
        keyVersion: 1,
      },
    });
    expect(res.status).toBe(201);
    secretId = res.body['id'] as string;
  });

  it('reads it back with every field intact', async () => {
    const res = await call(app, 'GET', `/vaults/${vaultId}/secrets/${secretId}`, { cookie });
    expect(res.status).toBe(200);

    const fields = res.body['fieldValues'] as Record<string, string>;
    expect(Object.keys(fields).sort()).toEqual(
      ['expires', 'host', 'key', 'passphrase', 'port', 'user'].sort(),
    );
    expect(await decrypt(vaultKey, fields['host'] as never)).toBe('db01.internal');
    expect(await decrypt(vaultKey, res.body['title'] as never)).toBe('prod-db-01');
  });

  /** The assertion the whole principle rests on. */
  it('leaves the migration state completely unchanged', () => {
    const after = migrationState();
    expect(after).toBe(before);
    expect(appliedCount(after)).toBe(appliedCount(before));
  });

  it('stores the custom values in JSONB, not in new columns', async () => {
    const columns = await db.prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'secret'`,
    );
    const names = columns.map((c) => c.column_name.toLowerCase());
    // None of the custom field ids became a column.
    for (const field of ['host', 'port', 'user', 'key', 'passphrase', 'expires']) {
      expect(names).not.toContain(field);
    }
    expect(names).toContain('fieldvalues');
  });
});

describe('versioning keeps existing secrets readable (FR-040)', () => {
  let templateId: string;
  let v1: string;
  let legacySecret: string;

  it('creates a template and a secret under version 1', async () => {
    const created = await call(app, 'POST', '/templates', {
      cookie,
      payload: {
        name: 'Membership Card',
        fields: [
          { id: 'number', label: 'Number', type: 'text', required: true, sensitive: true, order: 0 },
          { id: 'expiry', label: 'Expires', type: 'date', required: false, sensitive: false, order: 1 },
        ],
      },
    });
    templateId = created.body['templateId'] as string;
    v1 = created.body['versionId'] as string;

    const secret = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
      cookie,
      payload: {
        templateVersionId: v1,
        title: await encrypt(vaultKey, 'Gym'),
        fieldValues: { number: await encrypt(vaultKey, '99887766') },
        keyVersion: 1,
      },
    });
    legacySecret = secret.body['id'] as string;
  });

  it('editing the template creates a NEW version rather than mutating v1', async () => {
    const res = await call(app, 'PUT', `/templates/${templateId}`, {
      cookie,
      payload: {
        name: 'Membership Card',
        fields: [
          { id: 'number', label: 'Card number', type: 'text', required: true, sensitive: true, order: 0 },
          { id: 'holder', label: 'Member name', type: 'text', required: false, sensitive: false, order: 1 },
        ],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body['versionId']).not.toBe(v1);
    expect(res.body['version']).toBe(2);

    // Version 1 is untouched, which is what keeps the old secret meaningful.
    const original = await db.prisma.templateVersion.findUniqueOrThrow({ where: { id: v1 } });
    const fields = original.fields as Array<{ id: string; label: string }>;
    expect(fields.map((f) => f.label)).toEqual(['Number', 'Expires']);
  });

  it('the secret written under v1 still reads correctly', async () => {
    const res = await call(app, 'GET', `/vaults/${vaultId}/secrets/${legacySecret}`, { cookie });
    expect(res.status).toBe(200);
    expect(res.body['templateVersionId']).toBe(v1);

    const fields = res.body['fieldValues'] as Record<string, string>;
    expect(await decrypt(vaultKey, fields['number'] as never)).toBe('99887766');
  });

  it('reports which fields a change would orphan, so the user can be warned (FR-042)', async () => {
    const res = await call(app, 'POST', `/templates/${templateId}/impact`, {
      cookie,
      payload: {
        fields: [{ id: 'number', label: 'Card number', type: 'text', required: true, sensitive: true, order: 0 }],
      },
    });
    expect(res.status).toBe(200);
    // Dropping `expiry` and `holder` would strand any values already stored under them.
    expect(res.body['removedFields']).toEqual(expect.arrayContaining(['holder']));
    expect(res.body['affectedSecrets']).toEqual(expect.any(Number));
  });
});

describe('validation', () => {
  it('refuses two fields with the same label in one version (FR-043)', async () => {
    const res = await call(app, 'POST', '/templates', {
      cookie,
      payload: {
        name: 'Ambiguous',
        fields: [
          { id: 'a', label: 'Code', type: 'text', required: false, sensitive: false, order: 0 },
          { id: 'b', label: 'Code', type: 'text', required: false, sensitive: false, order: 1 },
        ],
      },
    });
    expect(res.status).toBe(422);
    expect(res.body['error']).toMatchObject({ code: 'TEMPLATE_FIELD_DUPLICATE' });
  });

  it('refuses two fields with the same id', async () => {
    const res = await call(app, 'POST', '/templates', {
      cookie,
      payload: {
        name: 'Colliding',
        fields: [
          { id: 'same', label: 'One', type: 'text', required: false, sensitive: false, order: 0 },
          { id: 'same', label: 'Two', type: 'text', required: false, sensitive: false, order: 1 },
        ],
      },
    });
    expect(res.status).toBe(422);
  });

  it('refuses an unknown field type rather than storing something unrenderable', async () => {
    const res = await call(app, 'POST', '/templates', {
      cookie,
      payload: {
        name: 'Odd',
        fields: [{ id: 'x', label: 'X', type: 'hologram', required: false, sensitive: false, order: 0 }],
      },
    });
    expect(res.status).toBe(400);
  });

  it('refuses a template with no fields', async () => {
    const res = await call(app, 'POST', '/templates', { cookie, payload: { name: 'Empty', fields: [] } });
    expect(res.status).toBe(400);
  });

  it("refuses to edit someone else's template", async () => {
    await call(app, 'POST', '/auth/register', { payload: await registration('other@example.com', PASSWORD) });
    const other = sessionCookie(
      await call(app, 'POST', '/auth/login', { payload: await login('other@example.com', PASSWORD) }),
    );
    const mine = await call(app, 'POST', '/templates', {
      cookie,
      payload: {
        name: 'Private',
        fields: [{ id: 'a', label: 'A', type: 'text', required: false, sensitive: false, order: 0 }],
      },
    });

    const res = await call(app, 'PUT', `/templates/${mine.body['templateId']}`, {
      cookie: other,
      payload: {
        name: 'Hijacked',
        fields: [{ id: 'a', label: 'A', type: 'text', required: false, sensitive: false, order: 0 }],
      },
    });
    expect(res.status).toBe(404);
  });

  it('refuses to edit a built-in template', async () => {
    const builtin = await db.prisma.template.findFirst({ where: { kind: 'builtin' } });
    if (!builtin) return;
    const res = await call(app, 'PUT', `/templates/${builtin.id}`, {
      cookie,
      payload: {
        name: 'Changed',
        fields: [{ id: 'a', label: 'A', type: 'text', required: false, sensitive: false, order: 0 }],
      },
    });
    expect(res.status).toBe(404);
  });
});

describe('resolving an older version so old secrets stay renderable (FR-040)', () => {
  let templateId: string;
  let v1: string;
  let v2: string;

  beforeAll(async () => {
    const created = await call(app, 'POST', '/templates', {
      cookie,
      payload: {
        name: 'Loyalty Card',
        fields: [{ id: 'num', label: 'Number', type: 'text', required: true, sensitive: true, order: 0 }],
      },
    });
    templateId = created.body['templateId'] as string;
    v1 = created.body['versionId'] as string;

    const edited = await call(app, 'PUT', `/templates/${templateId}`, {
      cookie,
      payload: {
        name: 'Loyalty Card',
        fields: [
          { id: 'num', label: 'Number', type: 'text', required: true, sensitive: true, order: 0 },
          { id: 'pin', label: 'PIN', type: 'password', required: false, sensitive: true, order: 1 },
        ],
      },
    });
    v2 = edited.body['versionId'] as string;
  });

  /** The gap this route exists to close: the list is current versions only. */
  it('omits the superseded version from the list', async () => {
    const res = await call(app, 'GET', '/templates', { cookie });
    const ids = (res.body as unknown as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(v2);
    expect(ids).not.toContain(v1);
  });

  it('resolves the superseded version by id, with the labels as they were authored', async () => {
    const res = await call(app, 'GET', `/templates/versions/${v1}`, { cookie });
    expect(res.status).toBe(200);
    expect(res.body['version']).toBe(1);
    expect(res.body['kind']).toBe('custom');
    // v2 renamed nothing but added a field; v1 must still describe exactly one.
    expect(res.body['fields']).toHaveLength(1);
  });

  it('resolves a built-in version too', async () => {
    const list = await call(app, 'GET', '/templates', { cookie });
    const builtin = (list.body as unknown as Array<{ id: string; kind: string }>).find(
      (t) => t.kind === 'builtin',
    );
    if (!builtin) return;
    expect((await call(app, 'GET', `/templates/versions/${builtin.id}`, { cookie })).status).toBe(200);
  });

  it("does not reveal a stranger's template, even by id", async () => {
    const stranger = sessionCookie(
      await call(app, 'POST', '/auth/login', { payload: await login('other@example.com', PASSWORD) }),
    );
    const res = await call(app, 'GET', `/templates/versions/${v1}`, { cookie: stranger });
    // 404, not 403: a 403 would confirm the id names something real.
    expect(res.status).toBe(404);
  });

  it('404s for a version that does not exist', async () => {
    const res = await call(app, 'GET', '/templates/versions/00000000-0000-4000-8000-000000000000', {
      cookie,
    });
    expect(res.status).toBe(404);
  });
});

describe('per-secret custom fields keep their labels secret (FR-039)', () => {
  it('stores the label as ciphertext, never as a column or a JSONB key', async () => {
    const list = await call(app, 'GET', '/templates', { cookie });
    const template = (list.body as unknown as Array<{ id: string }>)[0]!;

    // The client packs label AND value into one blob and encrypts the lot, so a label like
    // this one — which says a great deal on its own — never reaches the server in the clear.
    const label = 'Offshore recovery phrase';
    const blob = JSON.stringify([{ id: 'c1', label, value: 'correct horse', sensitive: true }]);

    const created = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
      cookie,
      payload: {
        templateVersionId: template.id,
        title: await encrypt(vaultKey, 'Bank'),
        fieldValues: { __custom: await encrypt(vaultKey, blob) },
        keyVersion: 1,
      },
    });
    expect(created.status).toBe(201);

    const row = await db.prisma.secret.findUniqueOrThrow({ where: { id: created.body['id'] as string } });
    const stored = JSON.stringify(row.fieldValues);
    expect(stored).not.toContain(label);
    expect(stored).not.toContain('correct horse');
    // The only key the server learns is the fixed, meaningless one.
    expect(Object.keys(row.fieldValues as Record<string, unknown>)).toEqual(['__custom']);

    const read = await call(app, 'GET', `/vaults/${vaultId}/secrets/${created.body['id']}`, { cookie });
    const back = (read.body['fieldValues'] as Record<string, string>)['__custom']!;
    expect(JSON.parse(await decrypt(vaultKey, back as never))[0].label).toBe(label);
  });
});
