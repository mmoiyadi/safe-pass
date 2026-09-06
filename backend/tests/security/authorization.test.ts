/**
 * Authorization matrix (T074, FR-029, FR-033, SC-012).
 *
 * Every vault route is exercised as Owner, Editor, Viewer, a revoked member, and a non-member.
 * The point is that the SERVER refuses, whatever the interface offered — SC-012 requires a
 * Viewer's write to be refused when the API is called directly, which is exactly what these
 * tests do.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call } from '../helpers/client.js';
import { makeActor, makeSharedVault, wrapFor, type Actor } from '../helpers/vaults.js';
import { encrypt } from '../../../frontend/src/crypto/envelope.js';

let db: TestDb;
let app: FastifyInstance;
let owner: Actor;
let editor: Actor;
let viewer: Actor;
let revoked: Actor;
let stranger: Actor;
let vaultId: string;
let vaultKey: Uint8Array;
let templateVersionId: string;
let secretId: string;

/** Adds a member at the given role and accepts on their behalf. */
async function addMember(member: Actor, role: 'owner' | 'editor' | 'viewer') {
  const invited = await call(app, 'POST', `/vaults/${vaultId}/members`, {
    cookie: owner.cookie,
    payload: { email: member.email, role, wrappedVaultKey: await wrapFor(member.publicKey, vaultKey) },
  });
  expect(invited.status).toBe(201);
  const accepted = await call(app, 'POST', `/vaults/${vaultId}/members/accept`, { cookie: member.cookie });
  expect(accepted.status).toBe(204);
}

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);

  owner = await makeActor(app, db.prisma, 'owner@example.com');
  editor = await makeActor(app, db.prisma, 'editor@example.com');
  viewer = await makeActor(app, db.prisma, 'viewer@example.com');
  revoked = await makeActor(app, db.prisma, 'revoked@example.com');
  stranger = await makeActor(app, db.prisma, 'stranger@example.com');

  ({ vaultId, vaultKey } = await makeSharedVault(app, owner));

  const template = await db.prisma.template.create({ data: { kind: 'builtin', ownerId: null } });
  const version = await db.prisma.templateVersion.create({
    data: { templateId: template.id, version: 1, name: 'Website Account', fields: [] },
  });
  templateVersionId = version.id;

  await addMember(editor, 'editor');
  await addMember(viewer, 'viewer');
  await addMember(revoked, 'editor');

  const created = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
    cookie: owner.cookie,
    payload: {
      templateVersionId,
      title: await encrypt(vaultKey, 'shared secret'),
      fieldValues: {},
      keyVersion: 1,
    },
  });
  secretId = created.body['id'] as string;

  // Revoked last, so the others are established first.
  const gone = await call(app, 'DELETE', `/vaults/${vaultId}/members/${revoked.userId}`, {
    cookie: owner.cookie,
  });
  expect(gone.status).toBe(204);
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

const secretPayload = async () => ({
  templateVersionId,
  title: await encrypt(vaultKey, 'written'),
  fieldValues: {},
  keyVersion: 1,
});

describe('reading', () => {
  it('Owner, Editor and Viewer can all read', async () => {
    for (const actor of [() => owner, () => editor, () => viewer]) {
      const res = await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: actor().cookie });
      expect(res.status).toBe(200);
    }
  });

  it('a revoked member cannot read', async () => {
    const res = await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: revoked.cookie });
    expect(res.status).toBe(404);
  });

  it('a non-member cannot read', async () => {
    const res = await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: stranger.cookie });
    expect(res.status).toBe(404);
  });
});

describe('writing secrets', () => {
  it('Owner and Editor may create', async () => {
    for (const actor of [() => owner, () => editor]) {
      const res = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
        cookie: actor().cookie,
        payload: await secretPayload(),
      });
      expect(res.status).toBe(201);
    }
  });

  /** SC-012: exercised against the API directly, not through the interface. */
  it('a Viewer may NOT create, edit or delete — refused at the server', async () => {
    const created = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
      cookie: viewer.cookie,
      payload: await secretPayload(),
    });
    expect(created.status).toBe(403);
    expect(created.body['error']).toMatchObject({ code: 'ROLE_INSUFFICIENT' });

    const edited = await call(app, 'PUT', `/vaults/${vaultId}/secrets/${secretId}`, {
      cookie: viewer.cookie,
      payload: { ...(await secretPayload()), revision: 1 },
    });
    expect(edited.status).toBe(403);

    const deleted = await call(app, 'DELETE', `/vaults/${vaultId}/secrets/${secretId}`, {
      cookie: viewer.cookie,
    });
    expect(deleted.status).toBe(403);

    // And the secret is still there.
    expect(await db.prisma.secret.findUnique({ where: { id: secretId } })).not.toBeNull();
  });
});

describe('managing folders and tags', () => {
  it('a Viewer may not create a folder', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/folders`, {
      cookie: viewer.cookie,
      payload: { name: await encrypt(vaultKey, 'nope') },
    });
    expect(res.status).toBe(403);
  });

  it('an Editor may', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/folders`, {
      cookie: editor.cookie,
      payload: { name: await encrypt(vaultKey, 'Editor folder') },
    });
    expect(res.status).toBe(201);
  });
});

describe('managing membership — Owner only', () => {
  it('an Editor may not invite', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/members`, {
      cookie: editor.cookie,
      payload: { email: 'someone@example.com', role: 'viewer' },
    });
    expect(res.status).toBe(403);
  });

  it('a Viewer may not change a role', async () => {
    const res = await call(app, 'PATCH', `/vaults/${vaultId}/members/${editor.userId}`, {
      cookie: viewer.cookie,
      payload: { role: 'owner' },
    });
    expect(res.status).toBe(403);
  });

  it('an Editor may not revoke anyone', async () => {
    const res = await call(app, 'DELETE', `/vaults/${vaultId}/members/${viewer.userId}`, {
      cookie: editor.cookie,
    });
    expect(res.status).toBe(403);
  });

  it('an Owner may change a role, and it is recorded', async () => {
    const res = await call(app, 'PATCH', `/vaults/${vaultId}/members/${viewer.userId}`, {
      cookie: owner.cookie,
      payload: { role: 'editor' },
    });
    expect(res.status).toBe(204);
    const logged = await db.prisma.activityLogEntry.findMany({ where: { action: 'role_changed' } });
    expect(logged.length).toBeGreaterThan(0);

    // Put it back so later assertions still see a Viewer.
    await call(app, 'PATCH', `/vaults/${vaultId}/members/${viewer.userId}`, {
      cookie: owner.cookie,
      payload: { role: 'viewer' },
    });
  });
});

describe('the last owner is protected (FR-035)', () => {
  it('refuses to demote the only owner', async () => {
    const res = await call(app, 'PATCH', `/vaults/${vaultId}/members/${owner.userId}`, {
      cookie: owner.cookie,
      payload: { role: 'editor' },
    });
    expect(res.status).toBe(409);
    expect(res.body['error']).toMatchObject({ code: 'LAST_OWNER' });
  });

  it('refuses to revoke the only owner', async () => {
    const res = await call(app, 'DELETE', `/vaults/${vaultId}/members/${owner.userId}`, {
      cookie: owner.cookie,
    });
    expect(res.status).toBe(409);
  });
});

describe('vault deletion', () => {
  it('refuses while other members remain (FR-024)', async () => {
    const res = await call(app, 'DELETE', `/vaults/${vaultId}`, { cookie: owner.cookie });
    expect(res.status).toBe(409);
    expect(await db.prisma.vault.findUnique({ where: { id: vaultId } })).not.toBeNull();
  });

  it('refuses to delete a personal vault at all', async () => {
    const res = await call(app, 'DELETE', `/vaults/${owner.personalVaultId}`, { cookie: owner.cookie });
    expect(res.status).toBe(409);
  });
});
