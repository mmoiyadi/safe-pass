/**
 * Client session flows: register, unlock, change password, re-authenticate.
 *
 * This module is the only place that turns a typed master password into keys. Every function
 * derives on this device and discards the password immediately afterwards.
 */
import type { Keyring, RegisterRequest, VaultSummary } from '@pm/shared';
import { bytesToBase64Url } from '@pm/shared';
import { api } from '../api/client.js';
import { buildLoginRequest, buildRegistrationRequest } from '../crypto/enrolment.js';
import { DEFAULT_KDF_PARAMS, deriveAuthHash, deriveMasterKey } from '../crypto/kdf.js';
import { deriveStretchedMasterKey } from '../crypto/master-key.js';
import { unwrapUserKey, wrapUserKey } from '../crypto/user-key.js';
import { requireAcceptableMasterPassword } from '../crypto/password-strength.js';
import { addMemberVaultKey, addSymmetricVaultKey, unlock, userKeyForTotp } from './keyring.js';
import { restartAutoLock } from './auto-lock.js';

export interface VaultWithWraps extends VaultSummary {
  keyWraps: Array<{ keyVersion: number; wrappedVaultKey: string }>;
}

/** Loads every vault the user can reach and unwraps its keys into the in-memory keyring. */
export async function loadVaults(): Promise<VaultWithWraps[]> {
  const vaults = await api<VaultWithWraps[]>('GET', '/vaults');
  for (const vault of vaults) {
    for (const wrap of vault.keyWraps) {
      // A personal vault's key is wrapped under the UserKey; a shared vault's is wrapped to
      // this member's RSA public key.
      if (vault.kind === 'personal') {
        await addSymmetricVaultKey(vault.id, wrap.keyVersion, wrap.wrappedVaultKey as never);
      } else {
        await addMemberVaultKey(vault.id, wrap.keyVersion, wrap.wrappedVaultKey as never);
      }
    }
  }
  return vaults;
}

/**
 * The wrapped keyring as fetched at sign-in. Held so a password change can rewrap the UserKey
 * without a second round-trip. It is wrapped material: useless without the master password.
 */
let currentKeyring: Keyring | null = null;
export const getKeyring = (): Keyring | null => currentKeyring;

export async function register(email: string, masterPassword: string): Promise<void> {
  // FR-002 — refuse before deriving, so a weak password never becomes a key.
  await requireAcceptableMasterPassword(masterPassword);

  const { request } = await buildRegistrationRequest(email, masterPassword);
  await api<{ email: string }>('POST', '/auth/register', request satisfies RegisterRequest);

  await unlockFromKeyring(masterPassword, email, {
    wrappedUserKey: request.wrappedUserKey,
    wrappedPrivateKey: request.wrappedPrivateKey,
    publicKey: request.publicKey,
  });
}

export interface SignInResult {
  /** True when a second factor is outstanding: the session exists but reaches nothing yet. */
  totpRequired: boolean;
  /** Held so the TOTP step can unwrap the seed, which is sealed under it. */
  userKey?: Uint8Array;
}

export async function signIn(email: string, masterPassword: string): Promise<SignInResult> {
  const response = await api<Keyring & { totpRequired?: boolean }>(
    'POST',
    '/auth/login',
    await buildLoginRequest(email, masterPassword),
  );

  if (response.totpRequired) {
    // The keyring is withheld until the factor clears, so derive only what the TOTP step
    // needs: the UserKey, which opens the sealed seed. Nothing is unlocked yet — no vault key
    // is held and no secret is reachable.
    const masterKey = await deriveMasterKey(masterPassword, email);
    const stretched = await deriveStretchedMasterKey(masterKey);
    const challenge = await api<{ wrappedUserKey: string }>('GET', '/auth/totp/challenge');
    const userKey = await unwrapUserKey(stretched, challenge.wrappedUserKey as never);
    masterKey.fill(0);
    stretched.fill(0);
    return { totpRequired: true, userKey };
  }

  await unlockFromKeyring(masterPassword, email, response);
  return { totpRequired: false };
}

/** Completes the unlock once the second factor has cleared. */
export async function completeAfterTotp(email: string, masterPassword: string): Promise<void> {
  const keyring = await api<Keyring>('GET', '/auth/keyring');
  await unlockFromKeyring(masterPassword, email, keyring);
}

async function unlockFromKeyring(
  masterPassword: string,
  email: string,
  keyring: Keyring,
): Promise<void> {
  currentKeyring = keyring;
  const masterKey = await deriveMasterKey(masterPassword, email);
  const stretchedMasterKey = await deriveStretchedMasterKey(masterKey);
  await unlock({
    stretchedMasterKey,
    wrappedUserKey: keyring.wrappedUserKey,
    wrappedPrivateKey: keyring.wrappedPrivateKey,
  });
  masterKey.fill(0);
  stretchedMasterKey.fill(0);
  restartAutoLock();
  await loadVaults();
}

/**
 * Changing the master password rewraps ONE key. No secret is re-encrypted, which is the whole
 * point of the UserKey layer (FR-005).
 */
export async function changeMasterPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
  currentWrappedUserKey: string,
): Promise<void> {
  await requireAcceptableMasterPassword(newPassword);

  const oldMaster = await deriveMasterKey(currentPassword, email);
  const newMaster = await deriveMasterKey(newPassword, email);
  const userKey = await unwrapUserKey(
    await deriveStretchedMasterKey(oldMaster),
    currentWrappedUserKey as never,
  );

  await api<void>('PUT', '/auth/master-password', {
    currentAuthHash: bytesToBase64Url(await deriveAuthHash(oldMaster, currentPassword)),
    newAuthHash: bytesToBase64Url(await deriveAuthHash(newMaster, newPassword)),
    newWrappedUserKey: await wrapUserKey(await deriveStretchedMasterKey(newMaster), userKey),
    newKdfParams: DEFAULT_KDF_PARAMS,
  });

  oldMaster.fill(0);
  newMaster.fill(0);
}

/** Clears a REAUTH_REQUIRED flag after the password was changed on another device (FR-074). */
export async function reauthenticate(email: string, masterPassword: string): Promise<void> {
  const masterKey = await deriveMasterKey(masterPassword, email);
  const keyring = await api<Keyring>('POST', '/auth/reauth', {
    authHash: bytesToBase64Url(await deriveAuthHash(masterKey, masterPassword)),
  });
  masterKey.fill(0);
  await unlockFromKeyring(masterPassword, email, keyring);
}

export { userKeyForTotp };

export async function signOut(): Promise<void> {
  const { lock } = await import('./keyring.js');
  currentKeyring = null;
  lock();
}
