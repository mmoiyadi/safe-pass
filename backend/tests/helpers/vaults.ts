/**
 * Shared fixtures for the sharing tests.
 *
 * Builds real accounts through the real registration route, so every key in play is one a
 * browser would actually have produced.
 */
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../prisma/generated/client/index.js';
import { call, sessionCookie } from './client.js';
import { login, registration } from './enrol.js';
import { buildRegistrationRequest } from '../../../frontend/src/crypto/enrolment.js';
import { deriveMasterKey } from '../../../frontend/src/crypto/kdf.js';
import { deriveStretchedMasterKey } from '../../../frontend/src/crypto/master-key.js';
import { unwrapPrivateKey, unwrapUserKey, importPublicKey } from '../../../frontend/src/crypto/user-key.js';
import {
  generateVaultKey,
  unwrapVaultKeyForMember,
  unwrapVaultKeySymmetric,
  wrapVaultKeyForMember,
} from '../../../frontend/src/crypto/vault-key.js';
import { encrypt } from '../../../frontend/src/crypto/envelope.js';
import { sentMail } from '../../src/modules/activity/mailer.js';

export const PASSWORD = 'correct horse battery staple';

/**
 * Completes the emailed verification, the way a real user does by clicking the link.
 *
 * Sharing requires a verified address (T144), so an actor that skipped this would be invisible
 * to every sharing test. Done through the real route rather than by writing `emailVerifiedAt`
 * directly, so these tests keep exercising the flow instead of stepping around it.
 */
export async function verifyEmail(app: FastifyInstance, email: string): Promise<void> {
  const mail = [...sentMail()].reverse().find((m) => m.to === email && /verify/i.test(m.subject));
  const token = mail?.body.match(/verify\?token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error(`no verification email was sent to ${email}`);

  const res = await call(app, 'POST', '/auth/verify', { payload: { token } });
  if (res.status !== 204) throw new Error(`verification failed: ${res.raw}`);
}

export interface Actor {
  email: string;
  cookie: string;
  userId: string;
  /** The account's own keys, unwrapped exactly as its browser would hold them. */
  userKey: Uint8Array;
  privateKey: CryptoKey;
  publicKey: string;
  personalVaultId: string;
}

export async function makeActor(
  app: FastifyInstance,
  prisma: PrismaClient,
  email: string,
): Promise<Actor> {
  const { request } = await buildRegistrationRequest(email, PASSWORD);
  const registered = await call(app, 'POST', '/auth/register', { payload: request });
  if (registered.status !== 201) throw new Error(`register failed: ${registered.raw}`);

  // A real account proves its address before anyone can share with it.
  await verifyEmail(app, email);

  const cookie = sessionCookie(
    await call(app, 'POST', '/auth/login', { payload: await login(email, PASSWORD) }),
  );

  const masterKey = await deriveMasterKey(PASSWORD, email);
  const stretched = await deriveStretchedMasterKey(masterKey);
  const userKey = await unwrapUserKey(stretched, request.wrappedUserKey);
  const privateKey = await unwrapPrivateKey(userKey, request.wrappedPrivateKey);

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { ownedVaults: true },
  });

  return {
    email,
    cookie,
    userId: user.id,
    userKey,
    privateKey,
    publicKey: request.publicKey,
    personalVaultId: user.ownedVaults[0]!.id,
  };
}

/** Creates a shared vault owned by `owner`, returning its id and the key only the owner holds. */
export async function makeSharedVault(
  app: FastifyInstance,
  owner: Actor,
  name = 'Household',
): Promise<{ vaultId: string; vaultKey: Uint8Array }> {
  const vaultKey = generateVaultKey();
  const res = await call(app, 'POST', '/vaults', {
    cookie: owner.cookie,
    payload: {
      name: await encrypt(vaultKey, name),
      wrappedVaultKey: await wrapVaultKeyForMember(await importPublicKey(owner.publicKey), vaultKey),
    },
  });
  if (res.status !== 201) throw new Error(`vault create failed: ${res.raw}`);
  return { vaultId: res.body['id'] as string, vaultKey };
}

/** Unwraps a vault key the way the named member's browser would. */
export async function openVaultKey(
  actor: Actor,
  wrapped: string,
  personal = false,
): Promise<Uint8Array> {
  return personal
    ? unwrapVaultKeySymmetric(actor.userKey, wrapped as never)
    : unwrapVaultKeyForMember(actor.privateKey, wrapped as never);
}

/** Wraps a vault key to a recipient's public key, as an owner's device would before sharing. */
export async function wrapFor(recipientPublicKey: string, vaultKey: Uint8Array): Promise<string> {
  return wrapVaultKeyForMember(await importPublicKey(recipientPublicKey), vaultKey);
}

export { registration, login };
