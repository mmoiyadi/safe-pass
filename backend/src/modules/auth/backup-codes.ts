/**
 * Backup codes (T109, FR-014).
 *
 * These exist because a second factor is a device, and devices are lost. Without them, losing a
 * phone would mean losing the account — and this system has no password recovery to fall back
 * on, so that loss would be permanent.
 *
 * Each code is single-use and stored only as a digest: a database dump yields nothing usable,
 * and the plaintext exists exactly once, in the response to enrolment.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '../../../prisma/generated/client/index.js';

export const CODE_COUNT = 10;
/** 40 bits per code: far beyond guessing at the rate limits on the sign-in route. */
const CODE_BYTES = 5;

const digest = (code: string): Buffer =>
  createHash('sha256').update(normalize(code)).digest();

/** Codes are shown grouped and typed back with or without the separator. */
const normalize = (code: string): string => code.replace(/[\s-]/g, '').toLowerCase();

function formatCode(raw: Buffer): string {
  // Base32-ish alphabet without characters people confuse: no 0/O, 1/l/I.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (const byte of raw) out += alphabet[byte % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/**
 * Issues a fresh set, replacing any that exist.
 *
 * Returns the plaintext codes — the only time they are ever available. The caller must show
 * them once and must not store them.
 */
export async function issueBackupCodes(
  prisma: PrismaClient,
  userId: string,
): Promise<string[]> {
  const codes = Array.from({ length: CODE_COUNT }, () => formatCode(randomBytes(CODE_BYTES)));

  await prisma.$transaction(async (tx) => {
    // Re-enrolling invalidates the old set: codes printed for a second factor that no longer
    // exists should not keep working.
    await tx.backupCode.deleteMany({ where: { userId } });
    await tx.backupCode.createMany({
      data: codes.map((code) => ({ userId, codeDigest: digest(code) })),
    });
  });

  return codes;
}

/**
 * Spends a code if it is valid and unused.
 *
 * Marking it used is part of the same query that selects it, so two simultaneous attempts with
 * the same code cannot both succeed.
 */
export async function redeemBackupCode(
  prisma: PrismaClient,
  userId: string,
  code: string,
): Promise<boolean> {
  const candidate = digest(code);
  const available = await prisma.backupCode.findMany({ where: { userId, usedAt: null } });

  const match = available.find((row) => {
    const stored = Buffer.from(row.codeDigest);
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  });
  if (!match) return false;

  // Conditional on still being unused: the update affects zero rows if another request won.
  const { count } = await prisma.backupCode.updateMany({
    where: { id: match.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

export async function remainingBackupCodes(prisma: PrismaClient, userId: string): Promise<number> {
  return prisma.backupCode.count({ where: { userId, usedAt: null } });
}
