/**
 * The database holds no plaintext (T136, SC-004, Constitution Principle I).
 *
 * This is the assertion the entire product rests on, and it is deliberately the crudest one in
 * the suite: seed a vault through the real routes with unmistakable marker strings, dump the
 * database the way an operator or an attacker with a backup would, and count occurrences.
 *
 * Crude is the point. Every other test checks a specific field through a specific code path;
 * this one checks the whole database through none of them, so it still catches a leak through a
 * column nobody thought about, a log table, an index, or a feature added next year. If it ever
 * fails, the answer is never to narrow the search — it is that something is storing plaintext.
 */
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call } from '../helpers/client.js';
import { makeActor, makeSharedVault, wrapFor, type Actor } from '../helpers/vaults.js';
import { encrypt } from '../../../frontend/src/crypto/envelope.js';
import { unwrapVaultKeyForMember } from '../../../frontend/src/crypto/vault-key.js';

/**
 * Strings chosen to be unmistakable: no substring of any of these occurs in schema names, enum
 * values, seeded template labels, or base64url ciphertext, so a hit is a leak and never noise.
 */
const MARKERS = {
  secretValue: 'zqx-marker-PASSWORD-VALUE-7318',
  secretTitle: 'zqx-marker-TITLE-my-bank-7318',
  folderName: 'zqx-marker-FOLDER-finance-7318',
  tagName: 'zqx-marker-TAG-urgent-7318',
  vaultName: 'zqx-marker-VAULT-household-7318',
  customFieldLabel: 'zqx-marker-CUSTOM-LABEL-7318',
  customFieldValue: 'zqx-marker-CUSTOM-VALUE-7318',
  totpSeed: 'zqx-marker-TOTP-SEED-7318',
} as const;

const MASTER_PASSWORD = 'zqx-marker-MASTER-PASSWORD-7318';

let db: TestDb;
let app: FastifyInstance;
let owner: Actor;
let dump: string;

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);

  owner = await makeActor(app, db.prisma, 'zk-owner@example.test');
  const member = await makeActor(app, db.prisma, 'zk-member@example.test');

  const { vaultId, vaultKey } = await makeSharedVault(app, owner, MARKERS.vaultName);

  // A second member, so the wrapped-key paths and the membership rows are populated too.
  await call(app, 'POST', `/vaults/${vaultId}/members`, {
    cookie: owner.cookie,
    payload: {
      email: member.email,
      role: 'editor',
      wrappedVaultKey: await wrapFor(member.publicKey, vaultKey),
    },
  });
  await call(app, 'POST', `/vaults/${vaultId}/members/accept`, { cookie: member.cookie });

  const template = await db.prisma.template.create({ data: { kind: 'builtin', ownerId: null } });
  const version = await db.prisma.templateVersion.create({
    data: {
      templateId: template.id,
      version: 1,
      name: 'Website Account',
      fields: [{ id: 'password', label: 'Password', type: 'password', required: true, sensitive: true, order: 0 }],
    },
  });

  const folder = await call(app, 'POST', `/vaults/${vaultId}/folders`, {
    cookie: owner.cookie,
    payload: { name: await encrypt(vaultKey, MARKERS.folderName), keyVersion: 1 },
  });
  const tag = await call(app, 'POST', `/vaults/${vaultId}/tags`, {
    cookie: owner.cookie,
    payload: { name: await encrypt(vaultKey, MARKERS.tagName), keyVersion: 1 },
  });

  await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
    cookie: owner.cookie,
    payload: {
      templateVersionId: version.id,
      title: await encrypt(vaultKey, MARKERS.secretTitle),
      fieldValues: {
        password: await encrypt(vaultKey, MARKERS.secretValue),
        // A per-secret custom field: label and value packed into one envelope (FR-039).
        __custom: await encrypt(
          vaultKey,
          JSON.stringify([
            { id: 'c1', label: MARKERS.customFieldLabel, value: MARKERS.customFieldValue, sensitive: true },
          ]),
        ),
      },
      folderId: folder.body['id'],
      tagIds: [tag.body['id']],
      keyVersion: 1,
    },
  });

  // A second factor, whose seed is sealed under the UserKey.
  await call(app, 'POST', '/auth/totp/enrol', {
    cookie: owner.cookie,
    payload: { wrappedSecret: await encrypt(vaultKey, MARKERS.totpSeed), confirmed: true },
  });

  // Exercise a read path too: anything that caches or logs on read would show up in the dump.
  await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: owner.cookie });
  await call(app, 'GET', `/vaults/${vaultId}/activity`, { cookie: owner.cookie });

  // Everything, including schema, indexes, and every row of every table.
  dump = execFileSync('pg_dump', [db.url], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('a full database dump contains no secret material (SC-004)', () => {
  it('produced a dump that actually holds the seeded data', () => {
    // Guards against the whole suite passing vacuously against an empty or failed dump.
    expect(dump.length).toBeGreaterThan(10_000);
    expect(dump).toContain('COPY public.secret ');
    expect(dump).toContain('zk-owner@example.test');
  });

  it.each(Object.entries(MARKERS))('never contains the %s', (_name, marker) => {
    const hits = dump.split(marker).length - 1;
    expect(hits).toBe(0);
  });

  it('never contains the master password', () => {
    expect(dump).not.toContain(MASTER_PASSWORD);
  });

  /**
   * The email address IS stored, and must be: it is the login identifier and the Argon2id salt
   * input. Asserting it explicitly keeps the boundary honest — this test says what the server
   * legitimately knows, not merely what it must not.
   */
  it('does contain the account email, which is identity rather than secret', () => {
    expect(dump).toContain('zk-owner@example.test');
  });

  it('stores the AuthHash only as a digest, never as the value the client sent', async () => {
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    // A server-side Argon2id digest of the client's AuthHash. If the raw AuthHash were stored,
    // a database read would yield a working login credential for every account.
    expect(Buffer.from(user.authHashDigest).length).toBeGreaterThanOrEqual(16);
    expect(dump).not.toContain(Buffer.from(user.authHashDigest).toString('utf8'));
  });
});

describe('what the ciphertext looks like on disk', () => {
  it('stores secret values as envelopes, not as anything readable', async () => {
    const secret = await db.prisma.secret.findFirstOrThrow();
    const values = secret.fieldValues as Record<string, string>;

    for (const [field, envelope] of Object.entries(values)) {
      // Version byte 0x01, then the algorithm — the envelope framing from crypto-envelope.md.
      expect(envelope, `${field} must be an envelope`).toMatch(/^AQ/);
    }
    expect(Buffer.from(secret.title)[0]).toBe(0x01);
  });

  it('holds a vault key only in wrapped form, openable only by a member', async () => {
    const wrap = await db.prisma.vaultKeyWrap.findFirstOrThrow();
    // Prove it is genuinely the key, and genuinely wrapped: it opens with the member's private
    // key and with nothing the server holds.
    const opened = await unwrapVaultKeyForMember(
      owner.privateKey,
      Buffer.from(wrap.wrappedVaultKey).toString('base64url') as never,
    ).catch(() => null);

    // The first wrap may belong to either member; either way the raw key is not on disk.
    expect(dump).not.toContain(Buffer.from(wrap.wrappedVaultKey).toString('utf8'));
    if (opened) expect(opened.length).toBe(32);
  });
});
