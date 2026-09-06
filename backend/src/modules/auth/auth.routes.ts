/**
 * Authentication routes.
 *
 * The server verifies knowledge of the master password and stores opaque bytes. There is no
 * code path here that decrypts anything, and none that could: no key material reaches it.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  ApiError,
  assertEnvelope,
  assertKeyWrap,
  authFailed,
  base64UrlToBytes,
  bytesToBase64Url,
  type KdfParams,
} from '@pm/shared';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { authLimit } from '../../middleware/rate-limit.js';
import { promotePendingInvitations } from '../vaults/invitation.service.js';
import {
  SESSION_COOKIE,
  cookieOptions,
  issueSession,
  markSiblingsForReauth,
  revokeAllExcept,
} from './session.js';

/**
 * Server-side digest of the client's AuthHash. The client's value is already an Argon2id
 * output, so a second memory-hard pass here would cost the server dearly per login while adding
 * little: the input has 256 bits of entropy, which is not brute-forcible regardless. What this
 * does buy is that a database dump yields nothing directly replayable at the login endpoint.
 */
const authDigest = (authHash: string): Buffer =>
  createHash('sha256').update(Buffer.from(authHash, 'base64url')).digest();

const DEFAULT_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  memoryKib: 65536,
  iterations: 3,
  parallelism: 1,
};

const normalize = (email: string): string => email.trim().toLowerCase();

/**
 * Envelope (base64url text) -> column bytes.
 *
 * The DECODED bytes are stored, not the base64url text. A `bytea` ciphertext column holding
 * base64 would carry 33% overhead for nothing, and the two representations are mutually
 * unreadable — so this conversion and `text()` below are the only places it may happen.
 */
const bytes = (envelope: string): Buffer => Buffer.from(base64UrlToBytes(envelope));

/**
 * Column bytes -> envelope text.
 *
 * Prisma 6 returns a `Uint8Array` for `Bytes`, NOT a Buffer. Calling `.toString(...)` on a
 * Uint8Array ignores the encoding argument and yields a comma-separated list of byte values —
 * with no error. Every read of a Bytes column must go through this function.
 */
const text = (column: Uint8Array): string => bytesToBase64Url(new Uint8Array(column));

/**
 * FR-003: failures must be indistinguishable in body, status, and timing. A constant floor is
 * applied so that "no such account" cannot be told from "wrong password" by response time.
 */
const FAILURE_FLOOR_MS = 250;
async function failUniformly(startedAt: number): Promise<never> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < FAILURE_FLOOR_MS) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_FLOOR_MS - elapsed));
  }
  throw authFailed();
}

export function authRoutes(prisma: PrismaClient) {
  return async function plugin(app: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
    /* ---------------------------------------------------------------- *
     * GET /auth/kdf-params
     * Answers for ANY address, real or not, so it cannot enumerate accounts (FR-003).
     * ---------------------------------------------------------------- */
    app.get('/kdf-params', { config: authLimit }, async (request) => {
      const email = normalize(String((request.query as { email?: string }).email ?? ''));
      const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
      if (!user) return DEFAULT_PARAMS;
      return {
        algorithm: user.kdfAlgorithm,
        memoryKib: user.kdfMemoryKib,
        iterations: user.kdfIterations,
        parallelism: user.kdfParallelism,
      } satisfies KdfParams;
    });

    /* ---------------------------------------------------------------- *
     * POST /auth/register
     * ---------------------------------------------------------------- */
    app.post('/register', { config: authLimit }, async (request, reply) => {
      const body = request.body as Record<string, unknown>;

      // FR-010: the account cannot exist without the no-recovery acknowledgement.
      if (body['recoveryAcknowledged'] !== true) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'Registration requires acknowledging that a forgotten master password is unrecoverable',
        );
      }

      const email = normalize(String(body['email'] ?? ''));
      if (!email.includes('@')) throw new ApiError('VALIDATION_FAILED', 'A valid email is required');
      const authHash = String(body['authHash'] ?? '');
      if (!authHash) throw new ApiError('VALIDATION_FAILED', 'authHash is required');

      // Structural validation only — the server confirms these parse as envelopes of a known
      // version and never inspects their contents.
      const wrappedUserKey = assertKeyWrap(body['wrappedUserKey'], 'wrappedUserKey');
      const wrappedPrivateKey = assertKeyWrap(body['wrappedPrivateKey'], 'wrappedPrivateKey');
      const wrappedVaultKey = assertKeyWrap(body['wrappedVaultKey'], 'wrappedVaultKey');
      const personalVaultName = assertEnvelope(body['personalVaultName'], 'personalVaultName');
      const publicKey = String(body['publicKey'] ?? '');
      if (!publicKey) throw new ApiError('VALIDATION_FAILED', 'publicKey is required');

      if (await prisma.user.findUnique({ where: { email } })) {
        // Deliberately vague: the message must not confirm which address is taken.
        throw new ApiError('LAST_OWNER', 'Registration could not be completed');
      }

      const params = (body['kdfParams'] as KdfParams | undefined) ?? DEFAULT_PARAMS;

      const { token } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            authHashDigest: authDigest(authHash),
            recoveryAcknowledgedAt: new Date(),
            // STAND-IN. The spec assumes email verification gates access to a shared vault,
            // and `/users/public-key` is specified to return 404 for unverified accounts — but
            // no user story tasks the verification flow itself, so nothing would ever set this
            // and every account would read as unverified. Marking verified at registration
            // keeps sharing working; see T144 in tasks.md for the real flow.
            emailVerifiedAt: new Date(),
            kdfAlgorithm: params.algorithm,
            kdfMemoryKib: params.memoryKib,
            kdfIterations: params.iterations,
            kdfParallelism: params.parallelism,
            keyring: {
              create: {
                wrappedUserKey: bytes(wrappedUserKey),
                publicKey: Buffer.from(base64UrlToBytes(publicKey)),
                wrappedPrivateKey: bytes(wrappedPrivateKey),
              },
            },
          },
        });

        const vault = await tx.vault.create({
          data: { ownerId: user.id, name: bytes(personalVaultName), kind: 'personal' },
        });
        const membership = await tx.vaultMembership.create({
          data: { vaultId: vault.id, userId: user.id, role: 'owner', status: 'active', acceptedAt: new Date() },
        });
        await tx.vaultKeyWrap.create({
          data: { membershipId: membership.id, keyVersion: 1, wrappedVaultKey: bytes(wrappedVaultKey) },
        });
        await tx.activityLogEntry.create({
          data: { vaultId: vault.id, actorId: user.id, action: 'vault_created' },
        });

        return issueSession(tx as unknown as PrismaClient, user.id, {
          deviceLabel: request.headers['user-agent']?.slice(0, 120),
        });
      });

      // FR-069: an invitation waiting on this address becomes completable, and the owner who
      // issued it is told. Outside the transaction because it sends mail, and a delivery
      // problem must not undo a successful registration.
      await promotePendingInvitations(prisma, email);

      reply.setCookie(SESSION_COOKIE, token, cookieOptions);
      return reply.code(201).send({ email });
    });

    /* ---------------------------------------------------------------- *
     * POST /auth/login
     * ---------------------------------------------------------------- */
    app.post('/login', { config: authLimit }, async (request, reply) => {
      const startedAt = Date.now();
      const body = request.body as { email?: string; authHash?: string };
      const email = normalize(String(body.email ?? ''));
      const authHash = String(body.authHash ?? '');

      const user = email
        ? await prisma.user.findUnique({ where: { email }, include: { keyring: true } })
        : null;

      // Compare against a dummy of the same shape when the account does not exist, so the
      // comparison itself costs the same either way.
      const candidate = authHash ? authDigest(authHash) : randomBytes(32);
      const stored = user ? Buffer.from(user.authHashDigest) : randomBytes(32);
      const ok = user !== null && candidate.length === stored.length && timingSafeEqual(candidate, stored);

      if (!ok || !user?.keyring) {
        if (user) {
          await prisma.signInEvent.create({ data: { userId: user.id, outcome: 'bad_password' } });
        }
        return failUniformly(startedAt);
      }

      const { token } = await issueSession(prisma, user.id, {
        deviceLabel: request.headers['user-agent']?.slice(0, 120),
      });
      await prisma.signInEvent.create({ data: { userId: user.id, outcome: 'success' } });

      reply.setCookie(SESSION_COOKIE, token, cookieOptions);
      // The keyring is wrapped material. It is useless without the master password.
      return {
        wrappedUserKey: text(user.keyring.wrappedUserKey),
        wrappedPrivateKey: text(user.keyring.wrappedPrivateKey),
        publicKey: text(user.keyring.publicKey),
      };
    });

    /* ---------------------------------------------------------------- *
     * PUT /auth/master-password  (FR-005, FR-072)
     * ---------------------------------------------------------------- */
    app.put('/master-password', async (request, reply) => {
      const session = request.session!;
      const body = request.body as Record<string, unknown>;

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: session.userId },
        include: { keyring: true },
      });

      // Requires the CURRENT master password, not merely a valid session: a stolen session must
      // not be sufficient to cause permanent, unrecoverable lockout (research.md §9).
      const current = authDigest(String(body['currentAuthHash'] ?? ''));
      const stored = Buffer.from(user.authHashDigest);
      if (current.length !== stored.length || !timingSafeEqual(current, stored)) {
        throw authFailed();
      }

      const newAuthHash = String(body['newAuthHash'] ?? '');
      if (!newAuthHash) throw new ApiError('VALIDATION_FAILED', 'newAuthHash is required');
      const newWrappedUserKey = assertKeyWrap(body['newWrappedUserKey'], 'newWrappedUserKey');
      const params = (body['newKdfParams'] as KdfParams | undefined) ?? DEFAULT_PARAMS;

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            authHashDigest: authDigest(newAuthHash),
            kdfAlgorithm: params.algorithm,
            kdfMemoryKib: params.memoryKib,
            kdfIterations: params.iterations,
            kdfParallelism: params.parallelism,
          },
        });
        // Exactly one rewrap. No secret is re-encrypted, no vault key is touched (FR-005).
        await tx.userKeyring.update({
          where: { userId: user.id },
          data: { wrappedUserKey: bytes(newWrappedUserKey), rotatedAt: new Date() },
        });
        await markSiblingsForReauth(tx as unknown as PrismaClient, user.id, session.id);
      });

      return reply.code(204).send();
    });

    /* ---------------------------------------------------------------- *
     * POST /auth/reauth  (FR-073, FR-074)
     * ---------------------------------------------------------------- */
    app.post('/reauth', { config: authLimit }, async (request) => {
      const session = request.session!;
      const authHash = String((request.body as { authHash?: string }).authHash ?? '');

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: session.userId },
        include: { keyring: true },
      });
      const candidate = authDigest(authHash);
      const stored = Buffer.from(user.authHashDigest);
      if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) {
        throw authFailed();
      }

      // Clears the flag. The second factor is NOT re-challenged (FR-074).
      await prisma.session.update({
        where: { id: session.id },
        data: { reauthRequiredAt: null },
      });

      return {
        wrappedUserKey: text(user.keyring!.wrappedUserKey),
        wrappedPrivateKey: text(user.keyring!.wrappedPrivateKey),
        publicKey: text(user.keyring!.publicKey),
      };
    });

    /* ---------------------------------------------------------------- *
     * GET / DELETE /auth/sessions  (FR-008)
     * ---------------------------------------------------------------- */
    app.get('/sessions', async (request) => {
      const session = request.session!;
      const rows = await prisma.session.findMany({
        where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
      });
      return rows.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        current: s.id === session.id,
        reauthRequired: s.reauthRequiredAt !== null,
      }));
    });

    app.delete('/sessions', async (request, reply) => {
      const session = request.session!;
      await revokeAllExcept(prisma, session.userId, session.id);
      return reply.code(204).send();
    });
  };
}
