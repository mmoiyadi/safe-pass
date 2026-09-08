import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerErrorHandler } from './middleware/errors.js';
import { loggerOptions } from './middleware/logging.js';
import { registerRateLimit } from './middleware/rate-limit.js';
import { registerStatic } from './static.js';
import { makeSessionGuard } from './middleware/session.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { accountRoutes } from './modules/auth/account.routes.js';
import { verifyRoutes } from './modules/auth/verify.routes.js';
import { totpRoutes, securityRoutes } from './modules/auth/totp.routes.js';
import { secretRoutes } from './modules/secrets/secrets.routes.js';
import { templateRoutes } from './modules/templates/templates.routes.js';
import { organiseRoutes } from './modules/secrets/organise.routes.js';
import { vaultRoutes } from './modules/vaults/vaults.routes.js';
import { sharingRoutes, accountSharingRoutes } from './modules/vaults/sharing.routes.js';
import { rotationRoutes } from './modules/vaults/rotation.routes.js';
import { exportRoutes } from './modules/backup/export.route.js';
import { importRoutes } from './modules/backup/import.route.js';
import type { PrismaClient } from '../prisma/generated/client/index.js';

export interface ServerDeps {
  prisma: PrismaClient;
  /**
   * Rate limiting is on by default and should stay on everywhere real requests arrive.
   * Suites that drive dozens of sign-ins from one address turn it off, because otherwise the
   * limiter — not the behaviour under test — decides the result. That it is actually applied
   * is asserted separately in tests/security/rate-limit.test.ts.
   */
  rateLimit?: boolean;
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
  await registerRateLimit(app, deps.rateLimit !== false);

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
  await app.register(totpRoutes(deps.prisma), { prefix: '/api/v1/auth' });
  await app.register(verifyRoutes(deps.prisma), { prefix: '/api/v1/auth' });
  await app.register(securityRoutes(deps.prisma), { prefix: '/api/v1' });
  await app.register(accountRoutes(deps.prisma), { prefix: '/api/v1/account' });
  await app.register(vaultRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(sharingRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(rotationRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(accountSharingRoutes(deps.prisma), { prefix: '/api/v1' });
  await app.register(secretRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(organiseRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(exportRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(importRoutes(deps.prisma), { prefix: '/api/v1/vaults' });
  await app.register(templateRoutes(deps.prisma), { prefix: '/api/v1/templates' });

  // Last, so every API route is already registered and wins the more-specific match.
  await registerStatic(app);

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

  /*
   * Rate limiting can be switched off ONLY outside production, and only deliberately.
   *
   * The end-to-end suite registers and signs in far more than ten times in fifteen minutes, so
   * the limiter — correctly — refuses it. Turning it off for that run is legitimate; turning it
   * off in production is not, so `NODE_ENV=production` overrides the flag rather than trusting
   * whoever set the environment.
   */
  const disableRateLimit =
    process.env['RATE_LIMIT'] === 'off' && process.env['NODE_ENV'] !== 'production';
  const app = await buildServer({ prisma, rateLimit: !disableRateLimit });
  if (disableRateLimit) {
    app.log.warn('rate limiting DISABLED (RATE_LIMIT=off, non-production)');
  }
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}
