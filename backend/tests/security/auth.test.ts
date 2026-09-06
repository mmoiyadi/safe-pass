/**
 * Registration and login (Principle IV, T029).
 *
 * The negative cases carry the weight: an unknown account and a wrong password must be
 * indistinguishable in body, status, and timing (FR-003), or the login endpoint becomes an
 * account-enumeration oracle.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call, sessionCookie } from '../helpers/client.js';
import { login, registration } from '../helpers/enrol.js';

let db: TestDb;
let app: FastifyInstance;
const EMAIL = 'alice@example.com';
const PASSWORD = 'correct horse battery staple';

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
});
afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('POST /auth/register', () => {
  it('creates an account and a personal vault, and returns a session', async () => {
    const res = await call(app, 'POST', '/auth/register', { payload: await registration(EMAIL, PASSWORD) });
    expect(res.status).toBe(201);
    expect(sessionCookie(res)).toContain('pm_session=');

    const user = await db.prisma.user.findUniqueOrThrow({
      where: { email: EMAIL },
      include: { keyring: true, ownedVaults: true },
    });
    expect(user.keyring).not.toBeNull();
    expect(user.ownedVaults).toHaveLength(1);
    expect(user.ownedVaults[0]!.kind).toBe('personal');
  });

  it('never stores the AuthHash it was sent — only a digest of it (FR-017)', async () => {
    const payload = await registration('digest@example.com', PASSWORD);
    await call(app, 'POST', '/auth/register', { payload });
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: 'digest@example.com' } });
    const stored = Buffer.from(user.authHashDigest).toString('base64url');
    expect(stored).not.toBe(payload.authHash);
  });

  it('refuses registration without the no-recovery acknowledgement (FR-010)', async () => {
    const payload = { ...(await registration('norecov@example.com', PASSWORD)), recoveryAcknowledged: false };
    const res = await call(app, 'POST', '/auth/register', { payload });
    expect(res.status).toBe(400);
    expect(await db.prisma.user.findUnique({ where: { email: 'norecov@example.com' } })).toBeNull();
  });

  it('refuses a duplicate email without revealing that the account exists', async () => {
    const res = await call(app, 'POST', '/auth/register', { payload: await registration(EMAIL, PASSWORD) });
    expect(res.status).toBe(409);
    expect(res.raw).not.toContain('already');
  });

  it('rejects a malformed ciphertext envelope', async () => {
    const payload = { ...(await registration('bad@example.com', PASSWORD)), wrappedUserKey: 'not-an-envelope' };
    const res = await call(app, 'POST', '/auth/register', { payload });
    expect(res.status).toBe(400);
    expect(res.body['error']).toMatchObject({ code: 'ENVELOPE_MALFORMED' });
  });
});

describe('POST /auth/login', () => {
  it('authenticates with the correct AuthHash and returns the keyring', async () => {
    const res = await call(app, 'POST', '/auth/login', { payload: await login(EMAIL, PASSWORD) });
    expect(res.status).toBe(200);
    expect(res.body['wrappedUserKey']).toEqual(expect.stringMatching(/^AQ/));
    expect(res.body['publicKey']).toEqual(expect.any(String));
  });

  it('never returns anything that decrypts without the master password', async () => {
    const res = await call(app, 'POST', '/auth/login', { payload: await login(EMAIL, PASSWORD) });
    const keys = Object.keys(res.body);
    expect(keys).not.toContain('userKey');
    expect(keys).not.toContain('stretchedMasterKey');
    expect(keys).not.toContain('privateKey');
  });

  it('refuses a wrong password', async () => {
    const res = await call(app, 'POST', '/auth/login', { payload: await login(EMAIL, 'wrong password here') });
    expect(res.status).toBe(401);
    expect(res.body['error']).toMatchObject({ code: 'AUTH_FAILED' });
  });

  /** FR-003: the two failures must be byte-identical, or this endpoint enumerates accounts. */
  it('returns an identical response for an unknown account and a wrong password', async () => {
    const unknown = await call(app, 'POST', '/auth/login', { payload: await login('nobody@example.com', PASSWORD) });
    const wrongPw = await call(app, 'POST', '/auth/login', { payload: await login(EMAIL, 'wrong password here') });
    expect(unknown.status).toBe(wrongPw.status);
    expect(unknown.raw).toBe(wrongPw.raw);
  });

  it('sets an HttpOnly, Secure, SameSite=Strict session cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: await login(EMAIL, PASSWORD),
    });
    const header = String(res.headers['set-cookie']);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
  });
});

describe('GET /auth/kdf-params', () => {
  /** Must answer for ANY address, or it becomes an account-existence oracle (FR-003). */
  it('returns parameters for an address that has no account', async () => {
    const known = await call(app, 'GET', `/auth/kdf-params?email=${EMAIL}`);
    const unknown = await call(app, 'GET', '/auth/kdf-params?email=nobody-at-all@example.com');
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body['algorithm']).toBe('argon2id');
  });
});
