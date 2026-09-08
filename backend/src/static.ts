/**
 * Serving the built web app from the API's own origin.
 *
 * Same origin is not a convenience here, it is a requirement. Session cookies are
 * `SameSite=Strict`, so a frontend on a different host would never send them; and a service
 * worker's scope is its origin, so the offline vault only works if the shell and the API share
 * one. Splitting them across two hosts breaks both, quietly.
 *
 * Nothing is served in development: Vite owns port 5173 and proxies `/api` to this server. If
 * the build is absent this registers nothing and says so, rather than failing to start — an API
 * that refuses to boot because a UI was not built is the wrong failure.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Everything the API answers lives under this prefix; everything else is the web app. */
export const API_PREFIX = '/api/';

function distDir(): string {
  const override = process.env['WEB_DIST'];
  if (override) return resolve(override);
  // dist/server.js -> backend/dist -> backend -> repo root -> frontend/dist
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'dist');
}

export async function registerStatic(app: FastifyInstance): Promise<boolean> {
  const root = distDir();
  if (!existsSync(join(root, 'index.html'))) {
    app.log.info({ root }, 'no web build found; serving the API only');
    return false;
  }

  await app.register(fastifyStatic, {
    root,
    // The catch-all below owns unmatched paths, so the plugin must not claim them first —
    // otherwise an unknown /api/ route would render the app shell instead of the JSON 404
    // that FR-030 requires.
    wildcard: false,
  });

  /*
   * The single-page fallback.
   *
   * A wildcard GET rather than a not-found handler: the not-found handler is already taken, and
   * for good reason (FR-030 — an unknown route must be indistinguishable from one the caller may
   * not see). Fastify prefers the more specific route, so every real API path still wins, and
   * anything under /api/ that reaches here is deliberately handed back to that JSON 404 rather
   * than being answered with HTML.
   */
  app.get('/*', async (request, reply) => {
    if (request.url.startsWith(API_PREFIX)) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    return reply.type('text/html').sendFile('index.html');
  });

  app.log.info({ root }, 'serving the web build');
  return true;
}
