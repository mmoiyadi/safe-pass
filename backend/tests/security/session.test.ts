/**
 * Session lifecycle (Principle IV, T028).
 *
 * Expired, revoked, and cross-user tokens must all be refused. A session grants API access and
 * decrypts nothing, but API access is still enough to delete a vault.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call, sessionCookie } from '../helpers/client.js';
import { login, registration } from '../helpers/enrol.js';

let db: TestDb;
let app: FastifyInstance;
const PASSWORD = 'correct horse battery staple';

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
  await call(app, 'POST', '/auth/register', { payload: await registration('a@example.com', PASSWORD) });
  await call(app, 'POST', '/auth/register', { payload: await registration('b@example.com', PASSWORD) });
});
afterAll(async () => {
  await app.close();
  await db.drop();
});

const signIn = async (email: string) =>
  sessionCookie(await call(app, 'POST', '/auth/login', { payload: await login(email, PASSWORD) }));

describe('session guard', () => {
  it('allows a valid session', async () => {
    expect((await call(app, 'GET', '/auth/sessions', { cookie: await signIn('a@example.com') })).status).toBe(200);
  });

  it('refuses a request with no session', async () => {
    const res = await call(app, 'GET', '/auth/sessions');
    expect(res.status).toBe(401);
    expect(res.body['error']).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('refuses a forged token', async () => {
    expect((await call(app, 'GET', '/auth/sessions', { cookie: 'pm_session=not-a-real-token' })).status).toBe(401);
  });

  it('refuses an expired session', async () => {
    const cookie = await signIn('a@example.com');
    await db.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call(app, 'GET', '/auth/sessions', { cookie })).status).toBe(401);
    await db.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() + 86_400_000) } });
  });

  it('refuses a revoked session', async () => {
    const cookie = await signIn('a@example.com');
    expect((await call(app, 'GET', '/auth/sessions', { cookie })).status).toBe(200);
    await call(app, 'DELETE', '/auth/sessions', { cookie: await signIn('a@example.com') });
    expect((await call(app, 'GET', '/auth/sessions', { cookie })).status).toBe(401);
  });

  it('stores only a digest of the token, never the token', async () => {
    const cookie = await signIn('b@example.com');
    const token = cookie.split('=')[1]!;
    const sessions = await db.prisma.session.findMany();
    for (const s of sessions) {
      expect(Buffer.from(s.tokenDigest).toString('base64url')).not.toBe(token);
      expect(Buffer.from(s.tokenDigest).toString('utf8')).not.toContain(token);
    }
  });

  it("does not let one user's session act as another", async () => {
    const cookieA = await signIn('a@example.com');
    const res = await call(app, 'GET', '/auth/sessions', { cookie: cookieA });
    const userA = await db.prisma.user.findUniqueOrThrow({ where: { email: 'a@example.com' } });
    const rows = res.body as unknown as Array<{ id: string }>;
    const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    const sessions = await db.prisma.session.findMany({ where: { id: { in: ids } } });
    for (const s of sessions) expect(s.userId).toBe(userA.id);
  });
});
