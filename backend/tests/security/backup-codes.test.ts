/**
 * Second factor and backup codes (T104, FR-012 to FR-015).
 *
 * The properties that matter:
 *
 *  - a pending session reaches NOTHING but the challenge (the guard, not the interface, decides)
 *  - a backup code works exactly once
 *  - a time step cannot be spent twice, enforced server-side even though the server cannot
 *    compute the code itself
 *  - removing the second factor needs the master password, not merely a live session
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call, sessionCookie } from '../helpers/client.js';
import { login, registration } from '../helpers/enrol.js';
import { deriveAuthHash, deriveMasterKey } from '../../../frontend/src/crypto/kdf.js';
import { generateVaultKey } from '../../../frontend/src/crypto/vault-key.js';
import { encrypt } from '../../../frontend/src/crypto/envelope.js';
import { clearMail, sentMail } from '../../src/modules/activity/mailer.js';
import { bytesToBase64Url } from '@pm/shared';

let db: TestDb;
let app: FastifyInstance;
let cookie: string;
let backupCodes: string[];

const EMAIL = 'totp@example.com';
const PASSWORD = 'correct horse battery staple';

/** Any well-formed wrap works: the server stores the seal and can never open it. */
const wrappedSecret = async () => encrypt(generateVaultKey(), 'a totp seed');

const authHash = async () =>
  bytesToBase64Url(await deriveAuthHash(await deriveMasterKey(PASSWORD, EMAIL), PASSWORD));

const signIn = async () =>
  call(app, 'POST', '/auth/login', { payload: await login(EMAIL, PASSWORD) });

const nowStep = () => Math.floor(Date.now() / 1000 / 30);

/**
 * Clears the spent-step record. A time step really can only be used once, so a suite that
 * verifies more than once inside 30 seconds has to stand in for the clock moving on.
 */
async function forgetLastStep(): Promise<void> {
  await db.prisma.totpEnrolment.updateMany({ data: { lastUsedStep: null } });
}

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
  await call(app, 'POST', '/auth/register', { payload: await registration(EMAIL, PASSWORD) });
  cookie = sessionCookie(await signIn());
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('enrolment', () => {
  it('refuses to enrol without confirming a code first', async () => {
    const res = await call(app, 'POST', '/auth/totp/enrol', {
      cookie,
      payload: { wrappedSecret: await wrappedSecret() },
    });
    expect(res.status).toBe(400);
  });

  it('stores the seed as an opaque wrap the server cannot read', async () => {
    const res = await call(app, 'POST', '/auth/totp/enrol', {
      cookie,
      payload: { wrappedSecret: await wrappedSecret(), confirmed: true },
    });
    expect(res.status).toBe(201);

    backupCodes = res.body['backupCodes'] as string[];
    expect(backupCodes).toHaveLength(10);

    const row = await db.prisma.totpEnrolment.findUniqueOrThrow({ where: { userId: await userId() } });
    // First byte is the envelope version: it is ciphertext, not a seed.
    expect(Buffer.from(row.wrappedSecret)[0]).toBe(0x01);
  });

  it('issues backup codes as digests, never as text', async () => {
    const rows = await db.prisma.backupCode.findMany({ where: { userId: await userId() } });
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      const stored = Buffer.from(row.codeDigest).toString('utf8');
      for (const code of backupCodes) expect(stored).not.toContain(code);
    }
  });
});

describe('a pending session reaches nothing', () => {
  let pending: string;

  beforeEach(async () => {
    const res = await signIn();
    expect(res.body['totpRequired']).toBe(true);
    // Login withholds the keyring entirely while the factor is outstanding.
    expect(res.body['wrappedUserKey']).toBeUndefined();
    pending = sessionCookie(res);
  });

  it('may fetch the challenge', async () => {
    const res = await call(app, 'GET', '/auth/totp/challenge', { cookie: pending });
    expect(res.status).toBe(200);
    expect(res.body['wrappedSecret']).toEqual(expect.stringMatching(/^AQ/));
  });

  /** The guard refuses, so a client that ignores the prompt gets nowhere. */
  it('is refused on every data route until the factor clears', async () => {
    for (const path of ['/vaults', '/auth/keyring', '/security/sign-ins', '/templates']) {
      const res = await call(app, 'GET', path, { cookie: pending });
      expect(res.status).toBe(401);
      expect(res.body['error']).toMatchObject({ code: 'TOTP_REQUIRED' });
    }
  });

  it('clears with a verified step, and only then yields the keyring', async () => {
    await forgetLastStep();
    const verified = await call(app, 'POST', '/auth/totp/verify', {
      cookie: pending,
      payload: { step: nowStep() },
    });
    expect(verified.status).toBe(204);

    const keyring = await call(app, 'GET', '/auth/keyring', { cookie: pending });
    expect(keyring.status).toBe(200);
    expect(keyring.body['wrappedUserKey']).toEqual(expect.stringMatching(/^AQ/));
  });
});

describe('replay protection (FR-013)', () => {
  it('refuses a step that has already been spent', async () => {
    await forgetLastStep();
    const pending = sessionCookie(await signIn());
    const step = nowStep();

    expect((await call(app, 'POST', '/auth/totp/verify', { cookie: pending, payload: { step } })).status).toBe(204);

    // A second session presenting the SAME step is a replay.
    const replay = sessionCookie(await signIn());
    const res = await call(app, 'POST', '/auth/totp/verify', { cookie: replay, payload: { step } });
    expect(res.status).toBe(401);
    expect(res.body['error']).toMatchObject({ code: 'TOTP_INVALID' });
  });

  it('refuses a step far from now, so a client cannot claim an arbitrary future one', async () => {
    const pending = sessionCookie(await signIn());
    const res = await call(app, 'POST', '/auth/totp/verify', {
      cookie: pending,
      payload: { step: nowStep() + 500 },
    });
    expect(res.status).toBe(401);
  });

  it('records a failed attempt in the sign-in history', async () => {
    const before = await db.prisma.signInEvent.count({ where: { outcome: 'bad_totp' } });
    const pending = sessionCookie(await signIn());
    await call(app, 'POST', '/auth/totp/verify', { cookie: pending, payload: { backupCode: 'not-real' } });
    expect(await db.prisma.signInEvent.count({ where: { outcome: 'bad_totp' } })).toBe(before + 1);
  });
});

describe('backup codes are single-use (FR-014)', () => {
  it('accepts a code once and refuses the same code afterwards', async () => {
    const code = backupCodes[0]!;

    const first = sessionCookie(await signIn());
    expect(
      (await call(app, 'POST', '/auth/totp/verify', { cookie: first, payload: { backupCode: code } })).status,
    ).toBe(204);

    const second = sessionCookie(await signIn());
    const res = await call(app, 'POST', '/auth/totp/verify', {
      cookie: second,
      payload: { backupCode: code },
    });
    expect(res.status).toBe(401);
  });

  it('accepts a different, unused code', async () => {
    const pending = sessionCookie(await signIn());
    const res = await call(app, 'POST', '/auth/totp/verify', {
      cookie: pending,
      payload: { backupCode: backupCodes[1]! },
    });
    expect(res.status).toBe(204);
  });

  it('tolerates the separator being typed or omitted', async () => {
    const pending = sessionCookie(await signIn());
    const res = await call(app, 'POST', '/auth/totp/verify', {
      cookie: pending,
      payload: { backupCode: backupCodes[2]!.replace('-', '').toUpperCase() },
    });
    expect(res.status).toBe(204);
  });

  it('notifies the account owner when one is used', async () => {
    clearMail();
    const pending = sessionCookie(await signIn());
    await call(app, 'POST', '/auth/totp/verify', { cookie: pending, payload: { backupCode: backupCodes[3]! } });
    expect(sentMail().some((m) => m.to === EMAIL && /backup code/i.test(m.subject))).toBe(true);
  });

  it('reissuing invalidates the previous set', async () => {
    const stillUnused = backupCodes[9]!;
    const fresh = await call(app, 'POST', '/auth/totp/backup-codes', {
      cookie,
      payload: { authHash: await authHash() },
    });
    expect(fresh.status).toBe(200);

    const pending = sessionCookie(await signIn());
    const res = await call(app, 'POST', '/auth/totp/verify', {
      cookie: pending,
      payload: { backupCode: stillUnused },
    });
    expect(res.status).toBe(401);

    backupCodes = fresh.body['backupCodes'] as string[];
  });
});

describe('removal requires the master password, not just a session (FR-015)', () => {
  it('refuses with a valid session but a wrong password', async () => {
    const res = await call(app, 'DELETE', '/auth/totp', { cookie, payload: { authHash: 'AAAA' } });
    expect(res.status).toBe(401);
    expect(await db.prisma.totpEnrolment.findUnique({ where: { userId: await userId() } })).not.toBeNull();
  });

  it('removes it with the master password, and destroys the backup codes with it', async () => {
    clearMail();
    const res = await call(app, 'DELETE', '/auth/totp', {
      cookie,
      payload: { authHash: await authHash() },
    });
    expect(res.status).toBe(204);

    expect(await db.prisma.totpEnrolment.findUnique({ where: { userId: await userId() } })).toBeNull();
    // Codes for a factor that no longer exists must not keep working.
    expect(await db.prisma.backupCode.count({ where: { userId: await userId() } })).toBe(0);

    expect(sentMail().some((m) => m.to === EMAIL && /two-factor/i.test(m.subject))).toBe(true);
  });

  it('sign-in no longer demands a second factor', async () => {
    const res = await signIn();
    expect(res.body['totpRequired']).toBeUndefined();
    expect(res.body['wrappedUserKey']).toEqual(expect.stringMatching(/^AQ/));
  });
});

describe('sign-in history', () => {
  it('lists the account’s own events, newest first', async () => {
    const res = await call(app, 'GET', '/security/sign-ins', { cookie: sessionCookie(await signIn()) });
    expect(res.status).toBe(200);
    const rows = res.body as unknown as Array<{ outcome: string; at: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(new Date(rows[0]!.at).getTime()).toBeGreaterThanOrEqual(new Date(rows[rows.length - 1]!.at).getTime());
  });

  it('records a location no finer than a rough region', async () => {
    const rows = await db.prisma.signInEvent.findMany({ where: { coarseLocation: { not: null } } });
    for (const row of rows) expect(row.coarseLocation).toMatch(/^(\d+\.\d+\.x\.x|unknown)$/);
  });
});

async function userId(): Promise<string> {
  return (await db.prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).id;
}
