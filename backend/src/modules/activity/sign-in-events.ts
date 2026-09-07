/**
 * Sign-in history and security notifications (T110, T112, research.md §9).
 *
 * This is the answer to the account-takeover edge case. With no password recovery, an intruder
 * who quietly changes the master password locks the owner out permanently — so the owner has to
 * be able to SEE that something happened, and be told when it does.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient, SignInOutcome } from '../../../prisma/generated/client/index.js';
import { sendMail } from './mailer.js';

/** research.md §9. Long enough to notice a pattern; short enough not to be a location archive. */
export const RETENTION_DAYS = 90;

/**
 * Devices are identified by a digest of the user agent, not the string itself.
 *
 * It is enough to tell "somewhere new" from "the browser you always use", which is all the
 * notification needs, without keeping a fingerprint that would sharpen the profile the operator
 * could build from metadata it can already see.
 */
const deviceFingerprint = (userAgent: string | undefined): string =>
  createHash('sha256').update(userAgent ?? 'unknown').digest('base64url').slice(0, 16);

export interface SignInContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export async function recordSignIn(
  prisma: PrismaClient,
  userId: string,
  outcome: SignInOutcome,
  context: SignInContext = {},
): Promise<{ newDevice: boolean }> {
  const fingerprint = deviceFingerprint(context.userAgent);

  const seenBefore = await prisma.signInEvent.findFirst({
    where: { userId, outcome: 'success', deviceLabel: fingerprint },
  });

  await prisma.signInEvent.create({
    data: {
      userId,
      outcome,
      deviceLabel: fingerprint,
      // Coarse by design: enough to say "this looks unfamiliar", not a location history.
      coarseLocation: context.ip ? coarse(context.ip) : null,
    },
  });

  return { newDevice: outcome === 'success' && seenBefore === null };
}

/** First two octets only — a rough region, never a precise address. */
function coarse(ip: string): string {
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : 'unknown';
}

export async function purgeOldSignInEvents(prisma: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.signInEvent.deleteMany({ where: { at: { lt: cutoff } } });
  return count;
}

/* ------------------------------------------------------------------ *
 * Notifications.
 *
 * Every one of these is a step an intruder takes on the way to permanent lockout, which is why
 * they are notified rather than merely logged. Mail failures never block the action: refusing a
 * password change because a mail server was down would be worse than the missing notice.
 * ------------------------------------------------------------------ */

export type SecurityEvent =
  | 'new_device'
  | 'master_password_changed'
  | 'totp_removed'
  | 'backup_code_used'
  | 'vault_exported';

const MESSAGES: Record<SecurityEvent, { subject: string; body: string }> = {
  new_device: {
    subject: 'Your vault was opened on a new device',
    body:
      'Your vault was just unlocked on a device we have not seen before.\n\n' +
      'If that was you, nothing to do.\n\n' +
      'If it was not, change your master password NOW from a device you trust, and sign out\n' +
      'the other sessions. Anyone who can unlock your vault can also change the password —\n' +
      'and because there is no recovery, that would lock you out permanently.\n',
  },
  master_password_changed: {
    subject: 'Your master password was changed',
    body:
      'The master password on your vault was just changed.\n\n' +
      'If that was you, nothing to do — your other devices will ask for the new one.\n\n' +
      'If it was NOT you, act immediately: whoever did it can now open your vault and you\n' +
      'cannot. There is no reset, so the sooner you contact anyone who shares a vault with\n' +
      'you, the better.\n',
  },
  totp_removed: {
    subject: 'Two-factor authentication was turned off',
    body:
      'The second factor on your account was just removed. Your vault is now protected by the\n' +
      'master password alone.\n\n' +
      'If this was not you, turn it back on and change your master password.\n',
  },
  backup_code_used: {
    subject: 'A backup code was used to sign in',
    body:
      'Someone signed in using one of your backup codes instead of your authenticator app.\n\n' +
      'If that was you, consider generating a fresh set — each code works only once.\n\n' +
      'If it was not you, change your master password now.\n',
  },
  vault_exported: {
    subject: 'A vault was exported',
    body:
      'An encrypted backup of one of your vaults was just downloaded.\n\n' +
      'The file is unreadable without the master password that was in force when it was taken.\n' +
      'If this was not you, change your master password — though note that a backup already\n' +
      'taken still opens with the OLD password.\n',
  },
};

export async function notify(
  prisma: PrismaClient,
  userId: string,
  event: SecurityEvent,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const message = MESSAGES[event];
  await sendMail({ to: user.email, subject: message.subject, body: message.body });
}
