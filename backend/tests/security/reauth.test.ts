/**
 * Master password change and session re-authentication (Principle IV, T030, FR-072 to FR-075).
 *
 * The decisive test replays a sibling session's cookie DIRECTLY against a data route. A client
 * that has already unwrapped the UserKey holds it in memory and can keep decrypting whatever it
 * has, so a client-side "please re-enter your password" prompt is advisory and a hostile client
 * ignores it. If this test can reach data with the old session, FR-073 is not implemented — no
 * matter what the interface does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call, sessionCookie } from '../helpers/client.js';
import { login, registration } from '../helpers/enrol.js';
import { buildRegistrationRequest } from '../../../frontend/src/crypto/enrolment.js';
import { deriveAuthHash, deriveMasterKey, DEFAULT_KDF_PARAMS } from '../../../frontend/src/crypto/kdf.js';
import { deriveStretchedMasterKey } from '../../../frontend/src/crypto/master-key.js';
import { unwrapUserKey, wrapUserKey } from '../../../frontend/src/crypto/user-key.js';
import { bytesToBase64Url } from '@pm/shared';

let db: TestDb;
let app: FastifyInstance;
const EMAIL = 'change@example.com';
const OLD = 'correct horse battery staple';
const NEW = 'an entirely different passphrase';

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
});
afterAll(async () => {
  await app.close();
  await db.drop();
});

const signIn = async (password: string) =>
  sessionCookie(await call(app, 'POST', '/auth/login', { payload: await login(EMAIL, password) }));

/** Builds the change payload exactly as the client would: rewrap the UserKey, nothing more. */
async function changePayload(wrappedUserKey: string) {
  const oldMk = await deriveMasterKey(OLD, EMAIL);
  const newMk = await deriveMasterKey(NEW, EMAIL);
  const userKey = await unwrapUserKey(await deriveStretchedMasterKey(oldMk), wrappedUserKey as never);
  return {
    currentAuthHash: bytesToBase64Url(await deriveAuthHash(oldMk, OLD)),
    newAuthHash: bytesToBase64Url(await deriveAuthHash(newMk, NEW)),
    newWrappedUserKey: await wrapUserKey(await deriveStretchedMasterKey(newMk), userKey),
    newKdfParams: DEFAULT_KDF_PARAMS,
  };
}

describe('master password change', () => {
  /** The client still holds this from registration; it is what a real change flow rewraps. */
  let wrappedUserKey: string;

  it('requires the CURRENT master password, not merely a valid session', async () => {
    const { request } = await buildRegistrationRequest(EMAIL, OLD);
    await call(app, 'POST', '/auth/register', { payload: request });
    wrappedUserKey = request.wrappedUserKey;
    const cookie = await signIn(OLD);

    const bad = { ...(await changePayload(wrappedUserKey)), currentAuthHash: 'AAAA' };
    const res = await call(app, 'PUT', '/auth/master-password', { payload: bad, cookie });
    expect(res.status).toBe(401);
  });

  it('rewraps the user key and leaves every secret untouched (FR-005)', async () => {
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, include: { keyring: true } });
    const before = Buffer.from(user.keyring!.wrappedUserKey);
    const cookie = await signIn(OLD);

    const res = await call(app, 'PUT', '/auth/master-password', {
      payload: await changePayload(wrappedUserKey),
      cookie,
    });
    expect(res.status).toBe(204);

    const after = await db.prisma.userKeyring.findUniqueOrThrow({ where: { userId: user.id } });
    expect(Buffer.from(after.wrappedUserKey).equals(before)).toBe(false);
    // The vault key wrap and every secret are untouched: only ONE row changed.
    const wraps = await db.prisma.vaultKeyWrap.findMany();
    expect(wraps).toHaveLength(1);
  });

  it('the old password no longer authenticates', async () => {
    const res = await call(app, 'POST', '/auth/login', { payload: await login(EMAIL, OLD) });
    expect(res.status).toBe(401);
  });

  it('the new password does', async () => {
    const res = await call(app, 'POST', '/auth/login', { payload: await login(EMAIL, NEW) });
    expect(res.status).toBe(200);
  });
});

describe('sibling sessions after a change (FR-072, FR-073)', () => {
  const EMAIL2 = 'sibling@example.com';
  const signIn2 = async (pw: string) =>
    sessionCookie(await call(app, 'POST', '/auth/login', { payload: { ...(await login(EMAIL2, pw)) } }));

  it('refuses a sibling session at the SERVER, not merely in the interface', async () => {
    const { request } = await buildRegistrationRequest(EMAIL2, OLD);
    await call(app, 'POST', '/auth/register', { payload: request });

    const browser1 = await signIn2(OLD);
    const browser2 = await signIn2(OLD);
    expect((await call(app, 'GET', '/auth/sessions', { cookie: browser2 })).status).toBe(200);

    // Change the password on browser 1.
    const oldMk = await deriveMasterKey(OLD, EMAIL2);
    const newMk = await deriveMasterKey(NEW, EMAIL2);
    const userKey = await unwrapUserKey(await deriveStretchedMasterKey(oldMk), request.wrappedUserKey);
    const changed = await call(app, 'PUT', '/auth/master-password', {
      cookie: browser1,
      payload: {
        currentAuthHash: bytesToBase64Url(await deriveAuthHash(oldMk, OLD)),
        newAuthHash: bytesToBase64Url(await deriveAuthHash(newMk, NEW)),
        newWrappedUserKey: await wrapUserKey(await deriveStretchedMasterKey(newMk), userKey),
        newKdfParams: DEFAULT_KDF_PARAMS,
      },
    });
    expect(changed.status).toBe(204);

    // THE assertion: replay browser 2's cookie straight at a data route.
    const replayed = await call(app, 'GET', '/auth/sessions', { cookie: browser2 });
    expect(replayed.status).toBe(401);
    expect(replayed.body['error']).toMatchObject({ code: 'REAUTH_REQUIRED' });

    // The session is stamped, not destroyed.
    const sessions = await db.prisma.session.findMany({ where: { reauthRequiredAt: { not: null } } });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.revokedAt === null)).toBe(true);

    // The session that made the change keeps working.
    expect((await call(app, 'GET', '/auth/sessions', { cookie: browser1 })).status).toBe(200);

    // Re-auth with the NEW password clears the flag and returns the rewrapped keyring.
    const ok = await call(app, 'POST', '/auth/reauth', {
      cookie: browser2,
      payload: { authHash: bytesToBase64Url(await deriveAuthHash(newMk, NEW)) },
    });
    expect(ok.status).toBe(200);
    expect(ok.body['wrappedUserKey']).toEqual(expect.stringMatching(/^AQ/));
    expect((await call(app, 'GET', '/auth/sessions', { cookie: browser2 })).status).toBe(200);
  });

  it('refuses re-auth with the OLD password', async () => {
    const browser3 = sessionCookie(await call(app, 'POST', '/auth/login', { payload: await login(EMAIL2, NEW) }));
    await db.prisma.session.updateMany({ data: { reauthRequiredAt: new Date() } });
    const oldMk = await deriveMasterKey(OLD, EMAIL2);
    const res = await call(app, 'POST', '/auth/reauth', {
      cookie: browser3,
      payload: { authHash: bytesToBase64Url(await deriveAuthHash(oldMk, OLD)) },
    });
    expect(res.status).toBe(401);
    expect(res.body['error']).toMatchObject({ code: 'AUTH_FAILED' });
  });
});
