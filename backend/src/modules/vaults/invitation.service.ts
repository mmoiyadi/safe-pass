/**
 * Invitations (T082, T083, T084, T085, T086).
 *
 * An invitation to an address with no account holds NO key material — not in the row, not in
 * the email, not in a link (FR-067). That is structural rather than cautious: the recipient's
 * keypair does not exist until they register, so no correct wrap can be made, and anything put
 * in its place would be openable by whoever holds the row or the message.
 *
 * The consequence is that access is not immediate. It needs an Owner's device online after the
 * recipient registers, because only that device holds the vault key (FR-068).
 */
import { ApiError, notFound } from '@pm/shared';
import type { PrismaClient, Role } from '../../../prisma/generated/client/index.js';
import { record } from '../activity/record.js';
import { sendMail } from '../activity/mailer.js';

export const INVITATION_DAYS = 14;

const normalize = (email: string): string => email.trim().toLowerCase();

/**
 * Records a pending invitation for an address that has no account yet.
 *
 * Refuses if the caller supplied key material: there is no keypair it could correctly belong
 * to, so its presence means either a mistake or an attempt to plant an openable key.
 */
export async function createPendingInvitation(
  prisma: PrismaClient,
  params: {
    vaultId: string;
    inviteeEmail: string;
    role: Role;
    invitedById: string;
    suppliedKeyMaterial: boolean;
  },
) {
  if (params.suppliedKeyMaterial) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'This address has no account, so there is no public key to wrap the vault key to. ' +
        'Send the invitation without key material; it can be completed once they register.',
    );
  }

  const email = normalize(params.inviteeEmail);
  const existing = await prisma.vaultInvitation.findFirst({
    where: { vaultId: params.vaultId, inviteeEmail: email, state: { in: ['pending', 'ready'] } },
  });
  if (existing) {
    throw new ApiError('INVITATION_EXISTS', 'An invitation to this address is already outstanding');
  }

  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.vaultInvitation.create({
      data: {
        vaultId: params.vaultId,
        inviteeEmail: email,
        role: params.role,
        invitedById: params.invitedById,
        state: 'pending',
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    await record(tx, {
      vaultId: params.vaultId,
      actorId: params.invitedById,
      action: 'invited',
      metadata: { role: params.role, pending: true },
    });
    return created;
  });

  // FR-066: the address is unverified and may simply be wrong, so the message names no vault
  // and carries nothing that opens one.
  await sendMail({
    to: email,
    subject: 'You have been invited to a shared vault',
    body:
      `Someone has invited you to share a vault with them.\n\n` +
      `This message deliberately does not say which vault, or what is in it. Nothing here\n` +
      `grants access — access is only possible once you have an account of your own, because\n` +
      `the vault key has to be encrypted to your personal key, and that key does not exist yet.\n\n` +
      `Create an account with this address, and the person who invited you can then complete it.\n\n` +
      `If you were not expecting this, you can ignore the message. It expires in ` +
      `${INVITATION_DAYS} days.\n`,
  });

  return invitation;
}

/**
 * Called after registration: any invitation waiting on this address becomes completable, and
 * the owners who issued it are told (FR-069).
 */
export async function promotePendingInvitations(prisma: PrismaClient, email: string): Promise<number> {
  const normalized = normalize(email);
  const waiting = await prisma.vaultInvitation.findMany({
    where: { inviteeEmail: normalized, state: 'pending' },
    include: { invitedBy: true },
  });
  if (waiting.length === 0) return 0;

  for (const invitation of waiting) {
    await prisma.$transaction(async (tx) => {
      await tx.vaultInvitation.update({ where: { id: invitation.id }, data: { state: 'ready' } });
      await record(tx, {
        vaultId: invitation.vaultId,
        actorId: null,
        action: 'invitation_ready',
      });
    });

    await sendMail({
      to: invitation.invitedBy.email,
      subject: 'An invitation you sent can now be completed',
      body:
        `${normalized} has created an account, so the invitation you sent them can now be\n` +
        `completed.\n\n` +
        `Completing it needs you specifically: the vault key has to be encrypted to their\n` +
        `personal key, and only your device holds that vault key. We cannot do it for you —\n` +
        `we have no copy of it.\n\n` +
        `Open the vault's sharing settings to finish.\n`,
    });
  }

  return waiting.length;
}

/**
 * Completes a ready invitation with a wrap the Owner's device produced.
 *
 * Creates the membership in `invited` state; the recipient still accepts to become active, so
 * the existing membership state machine is unchanged.
 */
export async function completeInvitation(
  prisma: PrismaClient,
  params: { vaultId: string; invitationId: string; actorId: string; wrappedVaultKey: Buffer; keyVersion: number },
) {
  const invitation = await prisma.vaultInvitation.findFirst({
    where: { id: params.invitationId, vaultId: params.vaultId },
  });
  if (!invitation) throw notFound();

  if (invitation.state !== 'ready') {
    throw new ApiError(
      'INVITATION_NOT_READY',
      invitation.state === 'pending'
        ? 'The recipient has not created an account yet, so there is no key to wrap the vault key to'
        : `This invitation is ${invitation.state} and can no longer be completed`,
    );
  }

  const vault = await prisma.vault.findUniqueOrThrow({ where: { id: params.vaultId } });
  if (params.keyVersion !== vault.keyVersion) {
    throw new ApiError('KEY_VERSION_STALE', 'The vault key changed; re-read it and try again');
  }

  const recipient = await prisma.user.findUnique({ where: { email: invitation.inviteeEmail } });
  if (!recipient) throw new ApiError('INVITATION_NOT_READY', 'The recipient no longer has an account');

  return prisma.$transaction(async (tx) => {
    const membership = await tx.vaultMembership.create({
      data: {
        vaultId: params.vaultId,
        userId: recipient.id,
        role: invitation.role,
        status: 'invited',
        invitedBy: params.actorId,
      },
    });
    await tx.vaultKeyWrap.create({
      data: {
        membershipId: membership.id,
        keyVersion: params.keyVersion,
        wrappedVaultKey: params.wrappedVaultKey,
      },
    });
    await tx.vaultInvitation.update({
      where: { id: invitation.id },
      data: { state: 'completed', completedAt: new Date(), membershipId: membership.id },
    });
    await record(tx, {
      vaultId: params.vaultId,
      actorId: params.actorId,
      subjectId: recipient.id,
      action: 'invitation_completed',
      metadata: { role: invitation.role },
    });
    return membership;
  });
}

export async function withdrawInvitation(
  prisma: PrismaClient,
  params: { vaultId: string; invitationId: string; actorId: string },
): Promise<void> {
  const invitation = await prisma.vaultInvitation.findFirst({
    where: { id: params.invitationId, vaultId: params.vaultId },
  });
  if (!invitation) throw notFound();
  if (invitation.state !== 'pending' && invitation.state !== 'ready') {
    throw new ApiError('INVITATION_EXISTS', `This invitation is already ${invitation.state}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.vaultInvitation.update({ where: { id: invitation.id }, data: { state: 'withdrawn' } });
    await record(tx, {
      vaultId: params.vaultId,
      actorId: params.actorId,
      action: 'invitation_withdrawn',
    });
  });
}
