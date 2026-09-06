import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerErrorHandler } from './middleware/errors.js';
import { loggerOptions } from './middleware/logging.js';
import { registerRateLimit } from './middleware/rate-limit.js';
import { makeSessionGuard } from './middleware/session.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { accountRoutes } from './modules/auth/account.routes.js';
import { secretRoutes, templateRoutes } from './modules/secrets/secrets.routes.js';
import { organiseRoutes } from './modules/secrets/organise.routes.js';
import { vaultRoutes } from './modules/vaults/vaults.routes.js';
import { sharingRoutes, accountSharingRoutes } from './modules/vaults/sharing.routes.js';
import { rotationRoutes } from './modules/vaults/rotation.routes.js';
import type { PrismaClient } from '../prisma/generated/client/index.js';

export interface ServerDeps {
  prisma: PrismaClient;
}

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({
    // Cast: pino's option type is wider than Fastify's published overload accepts.
    logger: loggerOptions as unknown as Record<string, unknown>,
    // The client sends ciphertext; a 5,000-secret rotation batch is the largest legitimate body.
    bodyLimit: 32 * 1024 * 1024,
    trustProxy: true,
  });

  registerErrorHandler(app);
  await registerRateLimit(app);

  await app.register(cookie, {
    secret: requireEnv('COOKIE_SECRET'),
    parseOptions: {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    },
  });

  // TLS only. The constitution requires all traffic be served over TLS; plaintext HTTP is
  // refused rather than redirected, because a redirect still transmits the original request.
  app.addHook('onRequest', async (request, reply) => {
    const proto = request.headers['x-forwarded-proto'];
    if (process.env['NODE_ENV'] === 'production' && proto && proto !== 'https') {
      return reply.code(400).send({
        error: { code: 'VALIDATION_FAILED', message: 'HTTPS required' },
      });
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.get('/api/v1/health', async () => ({ status: 'ok' }));

  // The guard runs before every route. Public paths are listed inside it rather than opted
  // into per route, so a new route is protected by default and must be explicitly exempted.
  app.addHook('onRequest', makeSessionGuard(deps.prisma));

  await app.register(authRoutes(deps.prisma), { prefix: '/api/v1/auth' });
  await app.register(accountRoutes(deps.prisma), { prefix: '/api/v1/account' });
  await app.register(vaultRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(sharingRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(rotationRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(accountSharingRoutes(deps.prisma), { prefix: '/api/v1' });
  await app.register(secretRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(organiseRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(templateRoutes(deps.prisma), { prefix: '/api/v1/templates' });

  return app;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const isEntrypoint = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isEntrypoint) {
  const { prisma } = await import('./db/client.js');
  const app = await buildServer({ prisma });
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}
