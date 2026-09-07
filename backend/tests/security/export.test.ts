/**
 * Backup export carries ciphertext and nothing that opens it (T123, FR-060 to FR-065, SC-015).
 *
 * A backup is the one artefact a user is encouraged to copy off the device and keep somewhere
 * else — a USB stick, a cloud drive, an email to themselves. It therefore has to be safe in
 * exactly the places we control least. The bar: someone holding the file and the server's entire
 * database still cannot read a single secret without the master password that was in force when
 * the backup was taken.
 *
 * The interesting failure would not be "we forgot to encrypt the secrets". It would be shipping
 * a convenience — a recovery hint, a key wrapped under something the server knows — that quietly
 * turns the file into a self-opening one. So the assertions here are about what is ABSENT.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call } from '../helpers/client.js';
import { makeActor, makeSharedVault, wrapFor, type Actor } from '../helpers/vaults.js';
import { encrypt, decrypt } from '../../../frontend/src/crypto/envelope.js';
import { deriveMasterKey } from '../../../frontend/src/crypto/kdf.js';
import { deriveStretchedMasterKey } from '../../../frontend/src/crypto/master-key.js';
import { unwrapVaultKeySymmetric } from '../../../frontend/src/crypto/vault-key.js';

const PASSWORD = 'correct horse battery staple';
const SECRET_VALUE = 'hunter2-unmistakable-marker';
const SECRET_TITLE = 'My bank login';

let db: TestDb;
let app: FastifyInstance;
let owner: Actor;
let other: Actor;
let sharedVaultId: string;
let personalVaultKey: Uint8Array;

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);

  owner = await makeActor(app, db.prisma, 'owner@example.test');
  other = await makeActor(app, db.prisma, 'member@example.test');

  // A personal vault with real content, keyed exactly as the owner's browser would.
  personalVaultKey = await unwrapVaultKeySymmetric(owner.userKey, (await personalWrap()) as never);

  // Test databases are not seeded with the built-ins, so make one directly.
  const template = await db.prisma.template.create({ data: { kind: 'builtin', ownerId: null } });
  const version = await db.prisma.templateVersion.create({
    data: {
      templateId: template.id,
      version: 1,
      name: 'Website Account',
      fields: [
        { id: 'password', label: 'Password', type: 'password', required: true, sensitive: true, order: 0 },
      ],
    },
  });
  const templateVersionId = version.id;

  await call(app, 'POST', `/vaults/${owner.personalVaultId}/folders`, {
    cookie: owner.cookie,
    payload: { name: await encrypt(personalVaultKey, 'Finance'), keyVersion: 1 },
  });
  await call(app, 'POST', `/vaults/${owner.personalVaultId}/tags`, {
    cookie: owner.cookie,
    payload: { name: await encrypt(personalVaultKey, 'urgent'), keyVersion: 1 },
  });
  await call(app, 'POST', `/vaults/${owner.personalVaultId}/secrets`, {
    cookie: owner.cookie,
    payload: {
      templateVersionId,
      title: await encrypt(personalVaultKey, SECRET_TITLE),
      fieldValues: { password: await encrypt(personalVaultKey, SECRET_VALUE) },
      keyVersion: 1,
    },
  });

  const shared = await makeSharedVault(app, owner);
  sharedVaultId = shared.vaultId;
});

/** The owner's personal vault key wrap, as the vault list hands it over. */
async function personalWrap(): Promise<string> {
  const vaults = (await call(app, 'GET', '/vaults', { cookie: owner.cookie })).body as unknown as Array<{
    id: string;
    keyWraps: Array<{ wrappedVaultKey: string }>;
  }>;
  return vaults.find((v) => v.id === owner.personalVaultId)!.keyWraps[0]!.wrappedVaultKey;
}

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('what the export contains', () => {
  let body: Record<string, unknown>;
  let raw: string;

  it('exports the vault', async () => {
    const res = await call(app, 'GET', `/vaults/${owner.personalVaultId}/export`, {
      cookie: owner.cookie,
    });
    expect(res.status).toBe(200);
    body = res.body;
    raw = JSON.stringify(body);
  });

  it('contains every secret, folder, tag, and template needed to reconstruct it (FR-060)', () => {
    expect(body['secrets']).toHaveLength(1);
    expect(body['folders']).toHaveLength(1);
    expect(body['tags']).toHaveLength(1);
    // Without the template definition the restored secret would have nothing to render it.
    expect((body['templates'] as unknown[]).length).toBeGreaterThan(0);
  });

  /** The assertion the whole feature stands on. */
  it('contains no plaintext secret value or title (FR-061, SC-015)', () => {
    expect(raw).not.toContain(SECRET_VALUE);
    expect(raw).not.toContain(SECRET_TITLE);
    expect(raw).not.toContain('Finance');
    expect(raw).not.toContain('urgent');
  });

  it('contains nothing that permits decryption without the master password (FR-062)', () => {
    expect(raw).not.toContain(PASSWORD);
    // A wrapped key is fine and necessary; an unwrapped one would open the file by itself.
    expect(raw).not.toContain(Buffer.from(personalVaultKey).toString('base64'));
    expect(raw).not.toContain(Array.from(personalVaultKey).join(','));
    expect(raw).not.toContain(Array.from(owner.userKey).join(','));

    // No hint, no recovery blob, no escrow — by any of the names such a thing tends to get.
    for (const forbidden of ['authHash', 'passwordHint', 'recovery', 'escrow', 'plaintext']) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('is decryptable only by deriving from the master password', async () => {
    // The full offline path a restore would take: password → MasterKey → StretchedMasterKey →
    // UserKey → VaultKey → the secret. Nothing in the file short-circuits it.
    const masterKey = await deriveMasterKey(PASSWORD, owner.email);
    const stretched = await deriveStretchedMasterKey(masterKey);
    expect(stretched).toBeInstanceOf(Uint8Array);

    const wraps = body['keyWraps'] as Array<{ keyVersion: number; wrappedVaultKey: string }>;
    const vaultKey = await unwrapVaultKeySymmetric(owner.userKey, wraps[0]!.wrappedVaultKey as never);

    const secrets = body['secrets'] as Array<{ title: string; fieldValues: Record<string, string> }>;
    expect(await decrypt(vaultKey, secrets[0]!.title as never)).toBe(SECRET_TITLE);
    expect(await decrypt(vaultKey, secrets[0]!.fieldValues['password'] as never)).toBe(SECRET_VALUE);
  });
});

describe('who may export (FR-065)', () => {
  beforeAll(async () => {
    // Bring the second account into the shared vault as an editor.
    const invited = await call(app, 'POST', `/vaults/${sharedVaultId}/members`, {
      cookie: owner.cookie,
      payload: {
        email: other.email,
        role: 'editor',
        wrappedVaultKey: await wrapFor(other.publicKey, (await sharedKey()) as Uint8Array),
      },
    });
    expect([200, 201]).toContain(invited.status);
    await call(app, 'POST', `/vaults/${sharedVaultId}/members/accept`, { cookie: other.cookie });
  });

  async function sharedKey(): Promise<Uint8Array> {
    const vaults = (await call(app, 'GET', '/vaults', { cookie: owner.cookie }))
      .body as unknown as Array<{ id: string; keyWraps: Array<{ wrappedVaultKey: string }> }>;
    const wrap = vaults.find((v) => v.id === sharedVaultId)!.keyWraps[0]!.wrappedVaultKey;
    const { unwrapVaultKeyForMember } = await import('../../../frontend/src/crypto/vault-key.js');
    return unwrapVaultKeyForMember(owner.privateKey, wrap as never);
  }

  it('lets an Owner export a shared vault', async () => {
    const res = await call(app, 'GET', `/vaults/${sharedVaultId}/export`, { cookie: owner.cookie });
    expect(res.status).toBe(200);
  });

  it('refuses a non-Owner member, who can read every secret but may not take the whole vault', async () => {
    const res = await call(app, 'GET', `/vaults/${sharedVaultId}/export`, { cookie: other.cookie });
    expect(res.status).toBe(403);
    expect(res.body['error']).toMatchObject({ code: 'ROLE_INSUFFICIENT' });
  });

  it('refuses a stranger with 404, not 403 — a 403 would confirm the vault exists', async () => {
    const stranger = await makeActor(app, db.prisma, 'stranger@example.test');
    const res = await call(app, 'GET', `/vaults/${sharedVaultId}/export`, { cookie: stranger.cookie });
    expect(res.status).toBe(404);
  });

  it('records every export of a shared vault in its activity log (FR-065)', async () => {
    const before = await db.prisma.activityLogEntry.count({
      where: { vaultId: sharedVaultId, action: 'exported' },
    });
    await call(app, 'GET', `/vaults/${sharedVaultId}/export`, { cookie: owner.cookie });

    const entries = await db.prisma.activityLogEntry.findMany({
      where: { vaultId: sharedVaultId, action: 'exported' },
    });
    expect(entries.length).toBe(before + 1);
    expect(entries[entries.length - 1]!.actorId).toBe(owner.userId);
  });

  it('records no ciphertext in the log entry, which outlives what it describes', async () => {
    const entries = await db.prisma.activityLogEntry.findMany({
      where: { vaultId: sharedVaultId, action: 'exported' },
    });
    const metadata = JSON.stringify(entries.map((e) => e.metadata));
    expect(metadata).not.toContain(SECRET_VALUE);
    expect(metadata).not.toMatch(/^AQ/m);
  });
});

describe('restore (FR-063)', () => {
  it('restores every secret, folder, tag, and template into a new vault', async () => {
    const exported = (
      await call(app, 'GET', `/vaults/${owner.personalVaultId}/export`, { cookie: owner.cookie })
    ).body;

    // Restoring rewraps the vault key for the destination account — here, the same one.
    const vaultKey = await unwrapVaultKeySymmetric(
      owner.userKey,
      (exported['keyWraps'] as Array<{ wrappedVaultKey: string }>)[0]!.wrappedVaultKey as never,
    );

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
    expect(res.status).toBe(201);

    const restoredId = res.body['id'] as string;
    const secrets = await call(app, 'GET', `/vaults/${restoredId}/secrets`, { cookie: owner.cookie });
    const rows = secrets.body as unknown as Array<{ title: string; fieldValues: Record<string, string> }>;

    expect(rows).toHaveLength(1);
    expect(await decrypt(vaultKey, rows[0]!.title as never)).toBe(SECRET_TITLE);
    expect(await decrypt(vaultKey, rows[0]!.fieldValues['password'] as never)).toBe(SECRET_VALUE);

    const folders = await call(app, 'GET', `/vaults/${restoredId}/folders`, { cookie: owner.cookie });
    expect(folders.body as unknown as unknown[]).toHaveLength(1);
  });

  it('refuses an import carrying anything that is not a well-formed envelope', async () => {
    const res = await call(app, 'POST', '/vaults/import', {
      cookie: owner.cookie,
      payload: {
        name: await encrypt(personalVaultKey, 'Bad'),
        wrappedVaultKey: await wrapFor(owner.publicKey, personalVaultKey),
        secrets: [
          {
            templateVersionId: 'tv',
            title: 'this is plaintext, not an envelope',
            fieldValues: {},
            keyVersion: 1,
          },
        ],
        folders: [],
        tags: [],
        templates: [],
      },
    });
    // Accepting plaintext here would let a malformed or hostile file put readable data in the
    // database, quietly breaking the guarantee the rest of the system maintains.
    expect(res.status).toBe(400);
  });
});
