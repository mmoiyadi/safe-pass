/**
 * Every data route lives under `/api/`, and unknown API paths stay indistinguishable.
 *
 * The session guard exempts paths outside `/api/` so the web app's shell can load — nobody can
 * sign in before the login screen has been fetched. That exemption is safe only while the
 * invariant below holds. A route registered outside `/api/` would be reachable with no session
 * at all, silently, and the guard's own "protected by default" promise would be false.
 *
 * So the invariant is tested rather than trusted. If someone adds `app.get('/admin', ...)` this
 * fails, which is the whole point.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { buildTestServer } from '../helpers/client.js';

let db: TestDb;
let app: FastifyInstance;

/*
 * Built with NO web build in reach, deliberately.
 *
 * `@fastify/static` registers one route per file, so with a build present the table is full of
 * `assets/*.js` and `fonts/*.woff2` — the shell, which is public by nature and tells us nothing
 * about whether an application route was left unguarded. Pointing WEB_DIST at nothing isolates
 * the routes this project actually writes, which are the ones the invariant is about.
 */
const NO_WEB_BUILD = '/nonexistent/web-dist';
let previousWebDist: string | undefined;

beforeAll(async () => {
  previousWebDist = process.env['WEB_DIST'];
  process.env['WEB_DIST'] = NO_WEB_BUILD;
  db = await createTestDb();
  app = await buildTestServer(db.prisma);
});

afterAll(async () => {
  await app.close();
  await db.drop();
  if (previousWebDist === undefined) delete process.env['WEB_DIST'];
  else process.env['WEB_DIST'] = previousWebDist;
});

describe('route namespacing', () => {
  it('registers every application route under /api/v1', () => {
    /*
     * With no web build, `printRoutes` prints a flat list at indent 0 and each entry carries its
     * full path. Anything indented below one of those is a child segment, already namespaced by
     * the parent it hangs from — so the top level is the whole of what needs checking.
     */
    const offenders = app
      .printRoutes({ commonPrefix: false })
      .split('\n')
      .filter((line) => /^[├└]── /u.test(line))
      .map((line) => line.replace(/^[├└]── /u, '').split(' ')[0] ?? '')
      .filter((path) => !path.startsWith('/api/v1/'));

    expect(
      offenders,
      `routes outside /api/v1 are not covered by the session guard: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});

describe('the guard still protects the API', () => {
  it('refuses a protected route with no session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vaults' });
    expect(res.statusCode).toBe(401);
  });

  /*
   * The guard runs before routing, so an unknown API path is refused for the same reason and
   * with the same response as one the caller may not see. That is FR-030's requirement met a
   * step earlier than the not-found handler, not a gap in it.
   */
  it('makes an unknown API path indistinguishable from a forbidden one (FR-030)', async () => {
    const unknown = await app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    const forbidden = await app.inject({ method: 'GET', url: '/api/v1/vaults' });

    expect(unknown.statusCode).toBe(forbidden.statusCode);
    expect(unknown.body).toBe(forbidden.body);
  });

  it('never answers an API path with the app shell', async () => {
    for (const url of ['/api/v1/nothing-here', '/api/v1/vaults/anything']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['content-type']).not.toContain('text/html');
      expect(res.body).not.toContain('<html');
    }
  });
});
