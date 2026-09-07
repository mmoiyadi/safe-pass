/**
 * Rate limiting is actually applied (FR-004, and the constitution's requirement that
 * authentication endpoints be rate-limited).
 *
 * The other suites turn limiting OFF so the limiter does not decide their results. This one
 * turns it back on, so nothing is taken on trust.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer, call } from '../helpers/client.js';
import { login, registration } from '../helpers/enrol.js';

let db: TestDb;
let app: FastifyInstance;

const EMAIL = 'ratelimited@example.com';
const PASSWORD = 'correct horse battery staple';

beforeAll(async () => {
  db = await createTestDb();
  app = await buildTestServer(db.prisma, { rateLimit: true });
  await call(app, 'POST', '/auth/register', { payload: await registration(EMAIL, PASSWORD) });
});

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe('login', () => {
  it('refuses once repeated attempts pass the limit', async () => {
    const payload = await login(EMAIL, 'a wrong password entirely');

    let limited = false;
    // Comfortably past the configured ceiling of 10 in 15 minutes.
    for (let attempt = 0; attempt < 25; attempt++) {
      const res = await call(app, 'POST', '/auth/login', { payload });
      if (res.status === 429) {
        expect(res.body['error']).toMatchObject({ code: 'RATE_LIMITED' });
        limited = true;
        break;
      }
    }

    expect(limited).toBe(true);
  });

  /** Guessing a password must not be cheaper than guessing which addresses exist. */
  it('limits attempts against an unknown address too', async () => {
    const payload = await login('nobody-at-all@example.com', PASSWORD);

    let limited = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      if ((await call(app, 'POST', '/auth/login', { payload })).status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
