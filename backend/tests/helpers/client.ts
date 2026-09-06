/**
 * Builds a server bound to a test database, plus a small request helper.
 *
 * Requests go through Fastify's `inject`, so every middleware — the session guard, the error
 * serializer, rate limiting — runs as it does in production. Calling route handlers directly
 * would skip the guard, which is the layer several of these tests exist to check.
 */
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import type { PrismaClient } from '../../prisma/generated/client/index.js';

export async function buildTestServer(prisma: PrismaClient): Promise<FastifyInstance> {
  process.env['COOKIE_SECRET'] ??= 'test-cookie-secret-at-least-32-bytes-long';
  return buildServer({ prisma });
}

export interface Res {
  status: number;
  body: Record<string, unknown>;
  raw: string;
  cookies: Array<{ name: string; value: string }>;
}

export async function call(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  opts: { payload?: unknown; cookie?: string } = {},
): Promise<Res> {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
    ...(opts.cookie ? { headers: { cookie: opts.cookie } } : {}),
  });
  let body: Record<string, unknown> = {};
  try {
    body = res.json() as Record<string, unknown>;
  } catch {
    /* empty body, e.g. 204 */
  }
  return {
    status: res.statusCode,
    body,
    raw: res.body,
    cookies: res.cookies.map((c) => ({ name: c.name, value: String(c.value) })),
  };
}

export const sessionCookie = (res: Res): string => {
  const c = res.cookies.find((x) => x.name === 'pm_session');
  if (!c) throw new Error('no session cookie set');
  return `pm_session=${c.value}`;
};
