/**
 * Registration and login request construction.
 *
 * Every value that leaves the device passes through here, which is why the no-leak test targets
 * these two functions specifically. Nothing in a returned request may be, or yield, the master
 * password or the StretchedMasterKey.
 */
import type { LoginRequest, RegisterRequest, VaultName } from '@pm/shared';
import { bytesToBase64Url } from '@pm/shared';
import { DEFAULT_KDF_PARAMS, deriveAuthHash, deriveMasterKey, normalizeEmail } from './kdf.js';
import { deriveStretchedMasterKey } from './master-key.js';
import { generateKeypair, generateUserKey, wrapUserKey } from './user-key.js';
import { generateVaultKey, wrapVaultKeySymmetric } from './vault-key.js';
import { encrypt } from './envelope.js';

export async function buildLoginRequest(
  email: string,
  masterPassword: string,
  params = DEFAULT_KDF_PARAMS,
): Promise<LoginRequest> {
  const masterKey = await deriveMasterKey(masterPassword, email, params);
  // Only the AuthHash. The StretchedMasterKey is derived at unlock and never leaves this device.
  return {
    email: normalizeEmail(email),
    authHash: bytesToBase64Url(await deriveAuthHash(masterKey, masterPassword)),
  };
}

export interface EnrolmentResult {
  request: RegisterRequest;
  /** Retained in memory by the caller to unlock immediately after registration. */
  keys: { userKey: Uint8Array; vaultKey: Uint8Array };
}

export async function buildRegistrationRequest(
  email: string,
  masterPassword: string,
  params = DEFAULT_KDF_PARAMS,
): Promise<EnrolmentResult> {
  const masterKey = await deriveMasterKey(masterPassword, email, params);
  const stretched = await deriveStretchedMasterKey(masterKey);
  const authHash = await deriveAuthHash(masterKey, masterPassword);

  const userKey = generateUserKey();
  const vaultKey = generateVaultKey();
  const keypair = await generateKeypair(userKey);

  return {
    request: {
      email: normalizeEmail(email),
      authHash: bytesToBase64Url(authHash),
      kdfParams: params,
      wrappedUserKey: await wrapUserKey(stretched, userKey),
      publicKey: keypair.publicKey,
      wrappedPrivateKey: keypair.wrappedPrivateKey,
      wrappedVaultKey: await wrapVaultKeySymmetric(userKey, vaultKey),
      personalVaultName: await encrypt<VaultName>(vaultKey, 'Personal'),
      recoveryAcknowledged: true,
    },
    keys: { userKey, vaultKey },
  };
}
