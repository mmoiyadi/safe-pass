/**
 * Email address verification (T144, spec Assumptions → "Registration is in scope").
 *
 * Verification exists for exactly one reason: sharing. A vault can only be shared with a named
 * account, and "named" is worth nothing if anyone can claim any address. Without this, inviting
 * `finance@company.example` could hand the vault key to whoever registered that address first.
 *
 * So the properties that matter are about the boundary, not the happy path:
 *
 *  - an unverified account can use its OWN vault (verification is not a gate on registration)
 *  - an unverified account cannot be found by, or added to, someone else's shared vault
 *  - the token is single-use, expiring, and stored only as a digest
 *  - a wrong or replayed token verifies nobody
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call, sessionCookie } from '../helpers/client.js';
import { login, registration } from '../helpers/enrol.js';
import { clearMail, sentMail } from '../../src/modules/activity/mailer.js';
import { encrypt } from '../../../frontend/src/crypto/envelope.js';
import { generateVaultKey } from '../../../frontend/src/crypto/vault-key.js';

const EMAIL = 'unverified@example.test';
const PASSWORD = 'correct horse battery staple';

let db: TestDb;
let app: FastifyInstance;

/** Pulls the verification link out of the message actually sent. */
function tokenFromMail(to: string): string | null {
  const mail = [...sentMail()].reverse().find((m) => m.to === to && /verify/i.test(m.subject));
  return mail?.body.match(/verify\?token=([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

async function registerFresh(email: string): Promise<{ cookie: string; token: string }> {
  clearMail();
  const res = await call(app, 'POST', '/auth/register', { payload: await registration(email, PASSWORD) });
  expect(res.status).toBe(201);
  const token = tokenFromMail(email);
  expect(token, 'registration must send a verification email').not.toBeNull();
  return {
    cookie: sessionCookie(await call(app, 'POST', '/auth/login', { payload: await login(email, PASSWORD) })),
    token: token!,
  };
}

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

/** Shared across both blocks: the account registered first is the one that gets verified. */
let registered: { cookie: string; token: string };

describe('registration leaves the address unverified', () => {
  let cookie: string;
  let token: string;

  it('creates the account without marking it verified', async () => {
    registered = await registerFresh(EMAIL);
    ({ cookie, token } = registered);
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.emailVerifiedAt).toBeNull();
  });

  it('stores the token only as a digest, so a database dump cannot verify anyone', async () => {
    const rows = await db.prisma.emailVerification.findMany();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Buffer.from(row.tokenDigest).toString('utf8')).not.toContain(token);
      expect(Buffer.from(row.tokenDigest).toString('base64url')).not.toContain(token);
    }
  });

  it('sends a link and nothing else — no password, no key', async () => {
    const fresh = await registerFresh('mailshape@example.test');
    expect(fresh.token).toBeTruthy();
    const mail = [...sentMail()].reverse().find((m) => m.to === 'mailshape@example.test');
    expect(mail).toBeDefined();
    expect(mail!.body).not.toContain(PASSWORD);
    // The token proves control of the mailbox. It must not also open a vault.
    expect(mail!.body).not.toMatch(/\bAQ[A-Za-z0-9_-]{20,}/);
  });

  /** Verification gates sharing, not the user's own vault. */
  it('lets the unverified account use its own personal vault', async () => {
    const vaults = await call(app, 'GET', '/vaults', { cookie });
    expect(vaults.status).toBe(200);
    expect((vaults.body as unknown as unknown[]).length).toBe(1);

    const vaultId = (vaults.body as unknown as Array<{ id: string }>)[0]!.id;
    const template = await db.prisma.template.create({ data: { kind: 'builtin', ownerId: null } });
    const version = await db.prisma.templateVersion.create({
      data: { templateId: template.id, version: 1, name: 'Note', fields: [] },
    });

    const created = await call(app, 'POST', `/vaults/${vaultId}/secrets`, {
      cookie,
      payload: {
        templateVersionId: version.id,
        title: await encrypt(generateVaultKey(), 'a secret'),
        fieldValues: {},
        keyVersion: 1,
      },
    });
    expect(created.status).toBe(201);
  });

  it('is invisible to anyone trying to share with it (spec: Invite to a non-user)', async () => {
    const sharer = await registerFresh('sharer@example.test');
    const res = await call(app, 'GET', `/users/public-key?email=${encodeURIComponent(EMAIL)}`, {
      cookie: sharer.cookie,
    });
    // 404, not 403: whether an address is registered is not something a stranger may learn.
    expect(res.status).toBe(404);
  });
});

describe('verifying', () => {
  it('refuses a token that was never issued', async () => {
    const res = await call(app, 'POST', '/auth/verify', { payload: { token: 'not-a-real-token' } });
    expect(res.status).toBe(400);
    expect(await db.prisma.user.count({ where: { emailVerifiedAt: { not: null } } })).toBe(0);
  });

  it('accepts the emailed token and marks the address verified', async () => {
    // No cookie is sent: the link is opened from a mail client, frequently on a different
    // device from the one holding the session. Requiring one would fail the people it protects.
    const res = await call(app, 'POST', '/auth/verify', { payload: { token: registered.token } });
    expect(res.status).toBe(204);

    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it('refuses the same token a second time (single use)', async () => {
    const replay = await call(app, 'POST', '/auth/verify', { payload: { token: registered.token } });
    expect(replay.status).toBe(400);
  });

  it('refuses an expired token', async () => {
    const stale = await registerFresh('expired@example.test');
    await db.prisma.emailVerification.updateMany({
      where: { usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await call(app, 'POST', '/auth/verify', { payload: { token: stale.token } });
    expect(res.status).toBe(400);

    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: 'expired@example.test' } });
    expect(user.emailVerifiedAt).toBeNull();
  });

  it('makes the account shareable-with once verified', async () => {
    const sharer = sessionCookie(
      await call(app, 'POST', '/auth/login', { payload: await login('sharer@example.test', PASSWORD) }),
    );
    const res = await call(app, 'GET', `/users/public-key?email=${encodeURIComponent(EMAIL)}`, {
      cookie: sharer,
    });
    expect(res.status).toBe(200);
    expect(res.body['publicKey']).toEqual(expect.any(String));
  });
});

describe('resending', () => {
  it('invalidates the previous token, so an intercepted old link stops working', async () => {
    const fresh = await registerFresh('rotate@example.test');
    const cookie = fresh.cookie;

    clearMail();
    await call(app, 'POST', '/auth/verify/resend', { cookie });
    const second = tokenFromMail('rotate@example.test');
    expect(second).not.toBe(fresh.token);

    expect((await call(app, 'POST', '/auth/verify', { payload: { token: fresh.token } })).status).toBe(400);
    expect((await call(app, 'POST', '/auth/verify', { payload: { token: second! } })).status).toBe(204);
  });

  it('says nothing about whether an address is already verified', async () => {
    const cookie = sessionCookie(
      await call(app, 'POST', '/auth/login', { payload: await login('rotate@example.test', PASSWORD) }),
    );
    // Already verified by the previous test. The response must not differ.
    const res = await call(app, 'POST', '/auth/verify/resend', { cookie });
    expect(res.status).toBe(202);
  });
});
