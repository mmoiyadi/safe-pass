/**
 * Session issue, lookup, and revocation.
 *
 * The server stores only a SHA-256 digest of the opaque token, so a database dump does not
 * yield usable sessions. A session grants API access and decrypts nothing — the vault key
 * lives only in the browser's memory (FR-016).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, Session } from '../../../prisma/generated/client/index.js';

export const SESSION_COOKIE = 'pm_session';
/** Absolute lifetime, per data-model.md. */
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export const digest = (token: string): Buffer => createHash('sha256').update(token).digest();

export async function issueSession(
  prisma: PrismaClient,
  userId: string,
  opts: { deviceLabel?: string | undefined; pendingTotp?: boolean } = {},
): Promise<{ token: string; session: Session }> {
  const token = randomBytes(32).toString('base64url');
  const session = await prisma.session.create({
    data: {
      userId,
      tokenDigest: digest(token),
      deviceLabel: opts.deviceLabel ?? null,
      expiresAt: new Date(Date.now() + LIFETIME_MS),
      pendingTotp: opts.pendingTotp ?? false,
    },
  });
  return { token, session };
}

export async function findLiveSession(
  prisma: PrismaClient,
  token: string,
): Promise<Session | null> {
  const session = await prisma.session.findUnique({ where: { tokenDigest: digest(token) } });
  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  return session;
}

export async function touch(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
}

export async function revokeAllExcept(
  prisma: PrismaClient,
  userId: string,
  keepId: string,
): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, id: { not: keepId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * FR-072: a master password change stamps every OTHER session as needing re-authentication.
 * The sessions stay established — they are not revoked — but the guard refuses them until they
 * present an AuthHash derived from the new password.
 */
export async function markSiblingsForReauth(
  prisma: PrismaClient,
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId, id: { not: currentSessionId }, revokedAt: null, reauthRequiredAt: null },
    data: { reauthRequiredAt: new Date() },
  });
  return count;
}

export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: LIFETIME_MS / 1000,
};
