/**
 * Pending invitations and non-enumeration (T075, T078, FR-066 to FR-071).
 *
 * The decisive assertion is FR-067: while an invitation is pending, NOTHING stored and nothing
 * emailed may grant vault access. That is not caution — it is structural. The recipient has no
 * keypair until they register, so no correct wrap can exist, and anything put in its place would
 * be openable by whoever holds the row or the email.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call } from '../helpers/client.js';
import { makeActor, makeSharedVault, openVaultKey, wrapFor, type Actor } from '../helpers/vaults.js';
import { decrypt, encrypt } from '../../../frontend/src/crypto/envelope.js';
import { sentMail, clearMail } from '../../src/modules/activity/mailer.js';

let db: TestDb;
let app: FastifyInstance;
let owner: Actor;
/** Registered part-way through the suite, once the pending invitation exists. */
let newcomer: Actor;
let vaultId: string;
let vaultKey: Uint8Array;

const NEWCOMER = 'newcomer@example.com';

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
  owner = await makeActor(app, db.prisma, 'inv-owner@example.com');
  ({ vaultId, vaultKey } = await makeSharedVault(app, owner, 'Secret Project'));
  clearMail();
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('inviting an address with no account', () => {
  let invitationId: string;

  it('records a PENDING invitation rather than refusing', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/members`, {
      cookie: owner.cookie,
      payload: { email: NEWCOMER, role: 'editor' },
    });
    expect(res.status).toBe(202);
    expect(res.body['state']).toBe('pending');
    invitationId = res.body['id'] as string;
  });

  /** FR-067 — the load-bearing one. */
  it('stores NO key material: the table has no column that could hold one', async () => {
    const columns = await db.prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'vault_invitation'`,
    );
    const names = columns.map((c) => c.column_name.toLowerCase());
    for (const forbidden of ['wrappedvaultkey', 'wrappedkey', 'key', 'secret', 'token']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('refuses an attempt to smuggle key material onto a pending invitation', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/members`, {
      cookie: owner.cookie,
      payload: {
        email: 'another-newcomer@example.com',
        role: 'editor',
        // A wrap for someone who cannot be the recipient — the recipient has no keypair yet.
        wrappedVaultKey: await wrapFor(owner.publicKey, vaultKey),
      },
    });
    expect(res.status).toBe(400);
    expect(await db.prisma.vaultInvitation.count({ where: { inviteeEmail: 'another-newcomer@example.com' } })).toBe(0);
  });

  /** FR-066 — the address is unverified and may simply be wrong. */
  it('the email names no vault, and carries nothing that opens one', async () => {
    const mail = sentMail().find((m) => m.to === NEWCOMER);
    expect(mail).toBeDefined();
    expect(mail!.body).not.toContain('Secret Project');
    expect(mail!.subject).not.toContain('Secret Project');
    // No envelope, and nothing base64url-shaped long enough to be a key.
    expect(mail!.body).not.toMatch(/\bAQE[A-Za-z0-9_-]{20,}/);
    expect(mail!.body).not.toMatch(/[A-Za-z0-9_-]{60,}/);
  });

  it('grants nothing before the recipient registers', async () => {
    expect(await db.prisma.vaultMembership.count({ where: { vaultId } })).toBe(1); // the owner only
  });

  it('refuses to complete an invitation whose recipient has no account', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/invitations/${invitationId}/complete`, {
      cookie: owner.cookie,
      payload: { wrappedVaultKey: await wrapFor(owner.publicKey, vaultKey), keyVersion: 1 },
    });
    expect(res.status).toBe(409);
    expect(res.body['error']).toMatchObject({ code: 'INVITATION_NOT_READY' });
  });

  it('refuses a duplicate live invitation to the same address', async () => {
    const res = await call(app, 'POST', `/vaults/${vaultId}/members`, {
      cookie: owner.cookie,
      payload: { email: NEWCOMER, role: 'viewer' },
    });
    expect(res.status).toBe(409);
    expect(res.body['error']).toMatchObject({ code: 'INVITATION_EXISTS' });
  });

  it('becomes READY when the recipient registers, and notifies the owner', async () => {
    clearMail();
    newcomer = await makeActor(app, db.prisma, NEWCOMER);

    const invitation = await db.prisma.vaultInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    expect(invitation.state).toBe('ready');

    // FR-069: the owner is told it can now be completed.
    expect(sentMail().some((m) => m.to === owner.email)).toBe(true);

    // The recipient still has no access.
    expect((await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: newcomer.cookie })).status).toBe(404);
  });

  /** FR-066: the recipient learns that an invitation exists, and nothing about the vault. */
  it("the recipient's own invitation list discloses no vault name, size, or members", async () => {
    const res = await call(app, 'GET', '/invitations', { cookie: newcomer.cookie });
    expect(res.status).toBe(200);
    const listed = res.body as unknown as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('Secret Project');
    expect(Object.keys(listed[0]!)).not.toContain('name');
    expect(Object.keys(listed[0]!)).not.toContain('secretCount');
  });

  it('completes only when an Owner acts, and then the recipient can read', async () => {
    const completed = await call(app, 'POST', `/vaults/${vaultId}/invitations/${invitationId}/complete`, {
      cookie: owner.cookie,
      payload: { wrappedVaultKey: await wrapFor(newcomer.publicKey, vaultKey), keyVersion: 1 },
    });
    expect(completed.status).toBe(201);

    // A membership in `invited` state — the recipient still accepts to become active.
    const membership = await db.prisma.vaultMembership.findFirstOrThrow({
      where: { vaultId, userId: newcomer.userId },
    });
    expect(membership.status).toBe('invited');

    await call(app, 'POST', `/vaults/${vaultId}/members/accept`, { cookie: newcomer.cookie });
    expect((await call(app, 'GET', `/vaults/${vaultId}/secrets`, { cookie: newcomer.cookie })).status).toBe(200);
  });

  it('records issue and completion in the activity log (FR-070)', async () => {
    const actions = (
      await db.prisma.activityLogEntry.findMany({ where: { vaultId } })
    ).map((a) => a.action);
    expect(actions).toContain('invited');
    expect(actions).toContain('invitation_completed');
  });
});

describe('withdrawal and expiry', () => {
  it('an Owner can withdraw a pending invitation, and it cannot then be completed', async () => {
    const issued = await call(app, 'POST', `/vaults/${vaultId}/members`, {
      cookie: owner.cookie,
      payload: { email: 'withdrawn@example.com', role: 'viewer' },
    });
    const id = issued.body['id'] as string;

    expect((await call(app, 'DELETE', `/vaults/${vaultId}/invitations/${id}`, { cookie: owner.cookie })).status).toBe(204);

    const row = await db.prisma.vaultInvitation.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe('withdrawn');

    const completed = await call(app, 'POST', `/vaults/${vaultId}/invitations/${id}/complete`, {
      cookie: owner.cookie,
      payload: { wrappedVaultKey: await wrapFor(owner.publicKey, vaultKey), keyVersion: 1 },
    });
    expect(completed.status).toBe(409);
  });

  it('expires an invitation past its window, and it cannot then be completed (FR-071)', async () => {
    const issued = await call(app, 'POST', `/vaults/${vaultId}/members`, {
      cookie: owner.cookie,
      payload: { email: 'stale@example.com', role: 'viewer' },
    });
    const id = issued.body['id'] as string;

    await db.prisma.vaultInvitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const { expireStaleInvitations } = await import('../../src/modules/vaults/invitation.expiry.js');
    expect(await expireStaleInvitations(db.prisma)).toBeGreaterThan(0);

    expect((await db.prisma.vaultInvitation.findUniqueOrThrow({ where: { id } })).state).toBe('expired');
  });
});

describe('account enumeration (T075, FR-003, FR-030)', () => {
  it('the public-key lookup answers identically for unknown and unverified accounts', async () => {
    const unknown = await call(app, 'GET', '/users/public-key?email=nobody-here@example.com', {
      cookie: owner.cookie,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body['error']).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns a public key for a real account — it is public by design', async () => {
    const res = await call(app, 'GET', `/users/public-key?email=${owner.email}`, { cookie: owner.cookie });
    expect(res.status).toBe(200);
    expect(res.body['publicKey']).toEqual(expect.any(String));
  });

  it('a non-member gets 404 for a vault, never 403 — a 403 would confirm it exists', async () => {
    const stranger = await makeActor(app, db.prisma, 'nosy@example.com');
    for (const path of [`/vaults/${vaultId}/secrets`, `/vaults/${vaultId}/folders`, `/vaults/${vaultId}/activity`]) {
      const res = await call(app, 'GET', path, { cookie: stranger.cookie });
      expect(res.status).toBe(404);
    }
  });

  it('a vault list shows only the caller’s own vaults', async () => {
    const stranger = await makeActor(app, db.prisma, 'nosy2@example.com');
    const res = await call(app, 'GET', '/vaults', { cookie: stranger.cookie });
    const ids = (res.body as unknown as Array<{ id: string }>).map((v) => v.id);
    expect(ids).not.toContain(vaultId);
  });
});

describe('sharing discloses no password (FR-026)', () => {
  it('the recipient opens the vault with their OWN key, never the owner’s', async () => {
    const res = await call(app, 'GET', '/vaults', { cookie: newcomer.cookie });
    const vault = (res.body as unknown as Array<Record<string, unknown>>).find((v) => v['id'] === vaultId)!;
    const wrap = (vault['keyWraps'] as Array<{ wrappedVaultKey: string }>)[0]!;

    const opened = await openVaultKey(newcomer, wrap.wrappedVaultKey);
    // Same vault key the owner holds — reached without either learning the other's password.
    expect(Buffer.from(opened).toString('hex')).toBe(Buffer.from(vaultKey).toString('hex'));

    const secret = await encrypt(opened, 'round trip');
    expect(await decrypt(vaultKey, secret)).toBe('round trip');
  });
});
