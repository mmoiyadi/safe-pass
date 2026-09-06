/**
 * Revocation and the two-generation rotation (T076, T077, T093).
 *
 * Three properties matter here, and each is a place where a plausible implementation goes wrong:
 *
 *  1. Refusal is IMMEDIATE and independent of re-encryption (FR-080). An implementation that
 *     waits for the rotation to finish leaves the revoked member reading for as long as it takes.
 *  2. A vault mid-rotation is FULLY readable by remaining members (FR-083). Rows sit at two
 *     generations at once, and a reader that selects by the vault's current version fails on
 *     every row the rotation has not reached.
 *  3. Close is refused while ANY secret, folder, tag, or vault name is still at the old
 *     generation (FR-081). Closing early destroys the only key that opens the rest — silently,
 *     and permanently.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call } from '../helpers/client.js';
import { makeActor, makeSharedVault, openVaultKey, wrapFor, type Actor } from '../helpers/vaults.js';
import { decrypt, encrypt } from '../../../frontend/src/crypto/envelope.js';
import { generateVaultKey } from '../../../frontend/src/crypto/vault-key.js';
import { bytesToBase64Url } from '@pm/shared';

/**
 * Every Bytes column here holds DECODED bytes, so it must be re-encoded to get the envelope or
 * key back. Reading one with .toString('utf8') yields garbage without raising anything.
 */
const asText = (column: Uint8Array): string => bytesToBase64Url(new Uint8Array(column));

let db: TestDb;
let app: FastifyInstance;
let owner: Actor;
let stays: Actor;
let goes: Actor;
let vaultId: string;
let vaultKey: Uint8Array;
let templateVersionId: string;

async function addMember(member: Actor, role: 'editor' | 'viewer' = 'editor') {
  await call(app, 'POST', `/vaults/${vaultId}/members`, {
    cookie: owner.cookie,
    payload: { email: member.email, role, wrappedVaultKey: await wrapFor(member.publicKey, vaultKey) },
  });
  await call(app, 'POST', `/vaults/${vaultId}/members/accept`, { cookie: member.cookie });
}

async function addSecret(title: string): Promise<string> {
  const res = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
    cookie: owner.cookie,
    payload: {
      templateVersionId,
      title: await encrypt(vaultKey, title),
      fieldValues: { note: await encrypt(vaultKey, `body of ${title}`) },
      keyVersion: 1,
    },
  });
  expect(res.status).toBe(201);
  return res.body['id'] as string;
}

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);

  owner = await makeActor(app, db.prisma, 'rot-owner@example.com');
  stays = await makeActor(app, db.prisma, 'rot-stays@example.com');
  goes = await makeActor(app, db.prisma, 'rot-goes@example.com');

  ({ vaultId, vaultKey } = await makeSharedVault(app, owner, 'Rotating'));

  const template = await db.prisma.template.create({ data: { kind: 'builtin', ownerId: null } });
  const version = await db.prisma.templateVersion.create({
    data: { templateId: template.id, version: 1, name: 'Secure Note', fields: [] },
  });
  templateVersionId = version.id;

  await addMember(stays);
  await addMember(goes);
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('revocation is immediate and independent of re-encryption (FR-080)', () => {
  let secretA: string;

  it('sets up: the member can read before revocation', async () => {
    secretA = await addSecret('before revocation');
    const res = await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: goes.cookie });
    expect(res.status).toBe(200);
    expect((res.body as unknown as unknown[]).length).toBeGreaterThan(0);
  });

  it('refuses the revoked member at once, before any re-encryption has run', async () => {
    const res = await call(app, 'DELETE', `/vaults/${vaultId}/members/${goes.userId}`, {
      cookie: owner.cookie,
    });
    expect(res.status).toBe(204);

    // Nothing has been re-encrypted yet — every row is still at generation 1.
    const stillOld = await db.prisma.secret.count({ where: { vaultId, keyVersion: 1 } });
    expect(stillOld).toBeGreaterThan(0);

    // And yet the member is already refused.
    expect((await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: goes.cookie })).status).toBe(404);
    expect(
      (await call(app, 'GET', `/vaults/${vaultId}/secrets/${secretA}`, { cookie: goes.cookie })).status,
    ).toBe(404);
  });

  it('deletes every key wrap the member held, at all generations (not just the current one)', async () => {
    const membership = await db.prisma.vaultMembership.findFirstOrThrow({
      where: { vaultId, userId: goes.userId },
    });
    expect(membership.status).toBe('revoked');
    expect(await db.prisma.vaultKeyWrap.count({ where: { membershipId: membership.id } })).toBe(0);
  });

  it('leaves the remaining members untouched', async () => {
    expect((await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: stays.cookie })).status).toBe(200);
  });

  it('records the revocation in the append-only log', async () => {
    const logged = await db.prisma.activityLogEntry.findMany({ where: { vaultId, action: 'revoked' } });
    expect(logged).toHaveLength(1);
  });
});

describe('a rotation opens with two live generations (research.md §11)', () => {
  let newKey: Uint8Array;

  /**
   * The server cannot open a rotation by itself: that needs a fresh vault key wrapped to every
   * remaining member's public key, and the server holds no key to generate or wrap one. An
   * Owner's device does it, which is what this stands in for.
   */
  it('is opened by an Owner, and gives every remaining member a wrap for BOTH generations', async () => {
    // Several secrets, so a partial batch later leaves a genuine mix of generations rather
    // than trivially rewriting the only row.
    for (const title of ['second', 'third', 'fourth']) await addSecret(title);

    newKey = generateVaultKey();
    const members = await db.prisma.vaultMembership.findMany({
      where: { vaultId, status: { in: ['active', 'invited'] } },
      include: { user: { include: { keyring: true } } },
    });

    const memberKeys = [];
    for (const m of members) {
      memberKeys.push({ userId: m.userId, wrappedVaultKey: await wrapFor(asText(m.user.keyring!.publicKey), newKey) });
    }

    const res = await call(app, 'POST', `/vaults/${vaultId}/rotation`, {
      cookie: owner.cookie,
      payload: { toVersion: 2, memberKeys },
    });
    expect(res.status).toBe(201);
    expect(res.body['fromVersion']).toBe(1);
    expect(res.body['toVersion']).toBe(2);

    // Opening re-encrypts nothing: every existing row is still at the old generation.
    expect(await db.prisma.secret.count({ where: { vaultId, keyVersion: 1 } })).toBeGreaterThan(0);

    for (const m of members) {
      const versions = (
        await db.prisma.vaultKeyWrap.findMany({ where: { membershipId: m.id } })
      ).map((w) => w.keyVersion).sort();
      expect(versions).toEqual([1, 2]);
    }
  });

  /** The FR-083 invariant: mid-rotation, EVERY row must open for a remaining member. */
  it('a remaining member can read rows at both generations at once', async () => {
    // Re-encrypt only some of the secrets, leaving the rest at generation 1.
    const all = await db.prisma.secret.findMany({ where: { vaultId } });
    const half = all.slice(0, Math.max(1, Math.floor(all.length / 2)));

    const batch = [];
    for (const row of half) {
      const title = await decrypt(vaultKey, asText(row.title) as never);
      batch.push({
        id: row.id,
        title: await encrypt(newKey, title),
        fieldValues: {},
      });
    }
    const applied = await call(app, 'POST', `/vaults/${vaultId}/rotation/batch`, {
      cookie: owner.cookie,
      payload: { toVersion: 2, secrets: batch },
    });
    expect(applied.status).toBe(200);

    const versions = new Set(
      (await db.prisma.secret.findMany({ where: { vaultId } })).map((s) => s.keyVersion),
    );
    expect(versions).toEqual(new Set([1, 2]));

    // The member holds both keys, so every row opens.
    const memberships = await call(app, 'GET', '/vaults', { cookie: stays.cookie });
    const vault = (memberships.body as unknown as Array<Record<string, unknown>>).find(
      (v) => v['id'] === vaultId,
    )!;
    const wraps = vault['keyWraps'] as Array<{ keyVersion: number; wrappedVaultKey: string }>;
    expect(wraps.map((w) => w.keyVersion).sort()).toEqual([1, 2]);

    const keyByVersion = new Map<number, Uint8Array>();
    for (const wrap of wraps) {
      keyByVersion.set(wrap.keyVersion, await openVaultKey(stays, wrap.wrappedVaultKey));
    }

    const rows = await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: stays.cookie });
    for (const row of rows.body as unknown as Array<Record<string, unknown>>) {
      const key = keyByVersion.get(row['keyVersion'] as number)!;
      await expect(decrypt(key, row['title'] as never)).resolves.toEqual(expect.any(String));
    }
  });

  it('a write during the rotation lands at the NEW generation, so the job never chases it', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
      cookie: stays.cookie,
      payload: {
        templateVersionId,
        title: await encrypt(newKey, 'written mid-rotation'),
        fieldValues: {},
        keyVersion: 2,
      },
    });
    expect(res.status).toBe(201);
    expect(res.body['keyVersion']).toBe(2);
  });

  it('refuses a second rotation while one is running', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/rotation`, {
      cookie: owner.cookie,
      payload: { toVersion: 3, memberKeys: [] },
    });
    expect(res.status).toBe(409);
    expect(res.body['error']).toMatchObject({ code: 'ROTATION_IN_PROGRESS' });
  });

  it('resumes from the cursor rather than restarting', async () => {
    const state = await call(app, 'GET', `/vaults/${vaultId}/rotation`, { cookie: owner.cookie });
    expect(state.body['doneCount']).toBeGreaterThan(0);
    expect(state.body['cursor']).not.toBeNull();
  });
});

/**
 * T093 — the check that prevents permanent loss of folder, tag and vault names.
 *
 * Closing on the secrets alone destroys the old generation's wraps while those three are still
 * encrypted under it. Nothing would report an error; the names would simply never open again.
 */
describe('close is refused until EVERYTHING at the old generation is rewritten (FR-081)', () => {
  let folderId: string;
  let tagId: string;

  it('sets up a folder and a tag at the old generation', async () => {
    const folder = await call(app, 'POST', `/vaults/${vaultId}/folders`, {
      cookie: owner.cookie,
      payload: { name: await encrypt(vaultKey, 'Old folder') },
    });
    folderId = folder.body['id'] as string;

    const tag = await call(app, 'POST', `/vaults/${vaultId}/tags`, {
      cookie: owner.cookie,
      payload: { name: await encrypt(vaultKey, 'old-tag') },
    });
    tagId = tag.body['id'] as string;

    // Both were created before the rotation opened, so both sit at generation 1.
    await db.prisma.folder.update({ where: { id: folderId }, data: { keyVersion: 1 } });
    await db.prisma.tag.update({ where: { id: tagId }, data: { keyVersion: 1 } });
  });

  it('refuses while secrets remain at the old generation', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/rotation/close`, { cookie: owner.cookie });
    expect(res.status).toBe(409);
  });

  it('still refuses once the secrets are done but the FOLDER is not', async () => {
    const stale = await db.prisma.secret.findMany({ where: { vaultId, keyVersion: 1 } });
    if (stale.length > 0) {
      await call(app, 'POST', `/vaults/${vaultId}/rotation/batch`, {
        cookie: owner.cookie,
        payload: {
          toVersion: 2,
          secrets: await Promise.all(
            stale.map(async (row) => ({
              id: row.id,
              title: await encrypt(generateVaultKey(), 'rewritten'),
              fieldValues: {},
            })),
          ),
        },
      });
    }
    expect(await db.prisma.secret.count({ where: { vaultId, keyVersion: 1 } })).toBe(0);

    const res = await call(app, 'POST', `/vaults/${vaultId}/rotation/close`, { cookie: owner.cookie });
    expect(res.status).toBe(409);
    // The old wraps must still be there — closing is what deletes them.
    const live = await db.prisma.vaultMembership.findMany({ where: { vaultId }, select: { id: true } });
    expect(
      await db.prisma.vaultKeyWrap.count({
        where: { keyVersion: 1, membershipId: { in: live.map((m) => m.id) } },
      }),
    ).toBeGreaterThan(0);
  });

  it('still refuses once folders are done but the TAG is not', async () => {
    await call(app, 'POST', `/vaults/${vaultId}/rotation/batch`, {
      cookie: owner.cookie,
      payload: { toVersion: 2, folders: [{ id: folderId, name: await encrypt(generateVaultKey(), 'New folder') }] },
    });
    expect(await db.prisma.folder.count({ where: { vaultId, keyVersion: 1 } })).toBe(0);

    expect((await call(app, 'POST', `/vaults/${vaultId}/rotation/close`, { cookie: owner.cookie })).status).toBe(409);
  });

  it('still refuses once tags are done but the VAULT NAME is not', async () => {
    await call(app, 'POST', `/vaults/${vaultId}/rotation/batch`, {
      cookie: owner.cookie,
      payload: { toVersion: 2, tags: [{ id: tagId, name: await encrypt(generateVaultKey(), 'new-tag') }] },
    });
    expect(await db.prisma.tag.count({ where: { vaultId, keyVersion: 1 } })).toBe(0);

    const res = await call(app, 'POST', `/vaults/${vaultId}/rotation/close`, { cookie: owner.cookie });
    expect(res.status).toBe(409);
  });

  it('closes only when all four are done, and then destroys the old generation', async () => {
    await call(app, 'POST', `/vaults/${vaultId}/rotation/batch`, {
      cookie: owner.cookie,
      payload: { toVersion: 2, vaultName: await encrypt(generateVaultKey(), 'Rotating') },
    });

    const res = await call(app, 'POST', `/vaults/${vaultId}/rotation/close`, { cookie: owner.cookie });
    expect(res.status).toBe(204);

    // Every wrap at the old generation is gone FOR THIS VAULT: the moment the revoked member's
    // copy of the old key stops opening anything (FR-084). Scoped deliberately — the actors'
    // personal vaults legitimately still hold generation-1 wraps of their own.
    const memberships = await db.prisma.vaultMembership.findMany({ where: { vaultId }, select: { id: true } });
    const ids = memberships.map((m) => m.id);
    expect(
      await db.prisma.vaultKeyWrap.count({ where: { keyVersion: 1, membershipId: { in: ids } } }),
    ).toBe(0);

    const vault = await db.prisma.vault.findUniqueOrThrow({ where: { id: vaultId } });
    expect(vault.keyVersion).toBe(2);
    expect(vault.nameKeyVersion).toBe(2);

    const rotation = await db.prisma.vaultRotation.findFirstOrThrow({ where: { vaultId } });
    expect(rotation.state).toBe('completed');
  });

  it('a second rotation may open once the first has closed', async () => {
    const members = await db.prisma.vaultMembership.findMany({
      where: { vaultId, status: 'active' },
      include: { user: { include: { keyring: true } } },
    });
    const third = generateVaultKey();
    const memberKeys = [];
    for (const m of members) {
      memberKeys.push({
        userId: m.userId,
        wrappedVaultKey: await wrapFor(asText(m.user.keyring!.publicKey), third),
      });
    }
    const res = await call(app, 'POST', `/vaults/${vaultId}/rotation`, {
      cookie: owner.cookie,
      payload: { toVersion: 3, memberKeys },
    });
    expect(res.status).toBe(201);
  });
});
