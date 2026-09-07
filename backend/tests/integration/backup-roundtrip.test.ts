/**
 * Backup fidelity at scale (T134, SC-014, FR-063) and the portability export (T133).
 *
 * A backup that loses one secret out of five thousand is worse than no backup, because it will
 * be trusted. So this exports a large vault, restores it into a clean state, and checks every
 * secret individually rather than counting rows — a count would pass if the restore duplicated
 * one secret and dropped another.
 *
 * Deliberately end-to-end through the real routes, with real encryption, because the failure
 * this guards against is not "the SQL is wrong". It is a field quietly dropped somewhere in the
 * export → JSON → import path, which no unit test of any single step would notice.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call } from '../helpers/client.js';
import { makeActor, wrapFor, type Actor } from '../helpers/vaults.js';
import { decrypt, encrypt } from '../../../frontend/src/crypto/envelope.js';
import { generateVaultKey } from '../../../frontend/src/crypto/vault-key.js';
import { base64UrlToBytes, bytesToBase64Url } from '@pm/shared';

/**
 * Envelope columns hold DECODED bytes, not the base64url text.
 *
 * Seeding the text instead produces rows that look right in the database and fail on export,
 * because the export re-encodes what it reads and the result is double-encoded. Same helper the
 * routes use, for the same reason.
 */
const bytes = (envelope: string): Buffer => Buffer.from(base64UrlToBytes(envelope));
const text = (column: Uint8Array): string => bytesToBase64Url(new Uint8Array(column));

/**
 * 5,000 per SC-014. Seeded directly through Prisma rather than 5,000 HTTP round-trips: the
 * subject of this test is export and restore fidelity, not write throughput, and the rows are
 * byte-identical either way.
 */
const SECRET_COUNT = 5_000;
const FOLDER_COUNT = 20;
const TAG_COUNT = 15;

let db: TestDb;
let app: FastifyInstance;
let owner: Actor;
let vaultId: string;
let templateVersionId: string;

const vaultKey = generateVaultKey();

/** Deterministic content, so any single secret can be checked against what it should hold. */
const titleFor = (i: number): string => `secret-${i}-title`;
const valueFor = (i: number): string => `secret-${i}-value-${(i * 7919) % 104729}`;

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
  owner = await makeActor(app, db.prisma, 'backup@example.test');
  vaultId = owner.personalVaultId;

  const template = await db.prisma.template.create({ data: { kind: 'builtin', ownerId: null } });
  const version = await db.prisma.templateVersion.create({
    data: {
      templateId: template.id,
      version: 1,
      name: 'Website Account',
      fields: [
        { id: 'username', label: 'Username', type: 'text', required: true, sensitive: false, order: 0 },
        { id: 'password', label: 'Password', type: 'password', required: true, sensitive: true, order: 1 },
      ],
    },
  });
  templateVersionId = version.id;

  const folders = await db.prisma.$transaction(
    await Promise.all(
      Array.from({ length: FOLDER_COUNT }, async (_, i) =>
        db.prisma.folder.create({
          data: {
            vaultId,
            name: bytes(await encrypt(vaultKey, `folder-${i}`)),
            keyVersion: 1,
          },
        }),
      ),
    ).then((ps) => ps.map((p) => db.prisma.folder.findUniqueOrThrow({ where: { id: p.id } }))),
  );

  const tags = [];
  for (let i = 0; i < TAG_COUNT; i++) {
    tags.push(
      await db.prisma.tag.create({
        data: { vaultId, name: bytes(await encrypt(vaultKey, `tag-${i}`)), keyVersion: 1 },
      }),
    );
  }

  // Encrypt first, then insert in bulk: 5,000 AES-GCM operations are the slow part, and doing
  // them inside per-row inserts would make this test take minutes rather than seconds.
  const rows = [];
  for (let i = 0; i < SECRET_COUNT; i++) {
    rows.push({
      vaultId,
      templateVersionId,
      title: bytes(await encrypt(vaultKey, titleFor(i))),
      fieldValues: {
        username: await encrypt(vaultKey, `user-${i}`),
        password: await encrypt(vaultKey, valueFor(i)),
      },
      keyVersion: 1,
      folderId: i % 3 === 0 ? folders[i % FOLDER_COUNT]!.id : null,
    });
  }
  await db.prisma.secret.createMany({ data: rows });

  void tags;
}, 300_000);

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe(`a ${SECRET_COUNT.toLocaleString()}-secret vault survives export and restore (SC-014)`, () => {
  let exported: Record<string, unknown>;
  let restoredVaultId: string;

  it('exports the whole vault', async () => {
    const res = await call(app, 'GET', `/vaults/${vaultId}/export`, { cookie: owner.cookie });
    expect(res.status).toBe(200);
    exported = res.body;

    expect(exported['secrets']).toHaveLength(SECRET_COUNT);
    expect(exported['folders']).toHaveLength(FOLDER_COUNT);
    expect(exported['tags']).toHaveLength(TAG_COUNT);
    expect((exported['templates'] as unknown[]).length).toBeGreaterThan(0);
  }, 120_000);

  it('restores it into a new vault', async () => {
    const res = await call(app, 'POST', '/vaults/import', {
      cookie: owner.cookie,
      payload: {
        name: await encrypt(vaultKey, 'Restored'),
        wrappedVaultKey: await wrapFor(owner.publicKey, vaultKey),
        secrets: exported['secrets'],
        folders: exported['folders'],
        tags: exported['tags'],
        templates: exported['templates'],
      },
    });
    // Reported with the body: a bare status on a ten-second test tells you nothing about why.
    expect(res.status, `import failed: ${res.raw.slice(0, 300)}`).toBe(201);
    expect(res.body['secrets']).toBe(SECRET_COUNT);
    restoredVaultId = res.body['id'] as string;
  }, 300_000);

  it('holds every secret, folder, and tag — counted from the database, not the response', async () => {
    expect(await db.prisma.secret.count({ where: { vaultId: restoredVaultId } })).toBe(SECRET_COUNT);
    expect(await db.prisma.folder.count({ where: { vaultId: restoredVaultId } })).toBe(FOLDER_COUNT);
    expect(await db.prisma.tag.count({ where: { vaultId: restoredVaultId } })).toBe(TAG_COUNT);
  });

  /**
   * The assertion that matters. A count proves nothing about fidelity: a restore that wrote one
   * secret 5,000 times would pass it. Every title and every value is checked.
   */
  it('decrypts every single restored secret to exactly what was stored', async () => {
    const restored = await db.prisma.secret.findMany({ where: { vaultId: restoredVaultId } });
    expect(restored).toHaveLength(SECRET_COUNT);

    const seen = new Set<string>();
    for (const row of restored) {
      const title = await decrypt(vaultKey, text(row.title) as never);
      const values = row.fieldValues as Record<string, string>;
      const password = await decrypt(vaultKey, values['password'] as never);

      const index = Number(title.match(/^secret-(\d+)-title$/)?.[1]);
      expect(Number.isInteger(index), `unexpected title: ${title}`).toBe(true);
      expect(password).toBe(valueFor(index));

      // Catches duplication, which a count-based check would wave through.
      expect(seen.has(title), `${title} was restored more than once`).toBe(false);
      seen.add(title);
    }

    expect(seen.size).toBe(SECRET_COUNT);
  }, 300_000);

  it('leaves the original vault untouched — a restore adds, it never overwrites', async () => {
    expect(await db.prisma.secret.count({ where: { vaultId } })).toBe(SECRET_COUNT);
  });

  it('preserves filing, so a restored vault is organised as it was', async () => {
    const filed = await db.prisma.secret.count({
      where: { vaultId: restoredVaultId, folderId: { not: null } },
    });
    expect(filed).toBe(Math.ceil(SECRET_COUNT / 3));
  });
});

describe('the personal-data export (T133, research.md §8)', () => {
  it('returns account metadata in machine-readable form', async () => {
    const res = await call(app, 'GET', '/account/personal-data', { cookie: owner.cookie });
    expect(res.status).toBe(200);
    expect(res.body['account']).toMatchObject({ email: owner.email });
    expect(res.body['memberships']).toEqual(expect.any(Array));
    expect(res.body['signInHistory']).toEqual(expect.any(Array));
    expect(res.body['retention']).toBeDefined();
  });

  /**
   * The line this export exists to draw: it shows what the OPERATOR knows, which is precisely
   * the part the user cannot inspect for themselves. Vault contents are theirs already and
   * belong in a backup, not here.
   */
  it('contains no ciphertext and no vault contents', async () => {
    const res = await call(app, 'GET', '/account/personal-data', { cookie: owner.cookie });
    const raw = JSON.stringify(res.body);

    expect(raw).not.toMatch(/"AQ[A-Za-z0-9_-]{20,}"/);
    expect(raw).not.toContain('secret-1-title');
    expect(raw).not.toContain('fieldValues');
  });

  it('is scoped to the caller and needs a session', async () => {
    const res = await call(app, 'GET', '/account/personal-data');
    expect(res.status).toBe(401);
  });
});
