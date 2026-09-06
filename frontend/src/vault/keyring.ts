/**
 * The in-memory keyring (FR-019, T038).
 *
 * Every unwrapped key lives here and nowhere else. It is never written to localStorage,
 * sessionStorage, IndexedDB, or a cookie, and it is cleared on lock, sign-out, auto-lock, and
 * tab teardown.
 *
 * Vault keys are held per GENERATION, because a vault mid-rotation has two live generations and
 * a member needs both. Readers select by the row's keyVersion; writers use the highest held.
 */
import type { Envelope, WrappedKey } from '@pm/shared';
import { unwrapPrivateKey, unwrapUserKey } from '../crypto/user-key.js';
import { unwrapVaultKeyForMember, unwrapVaultKeySymmetric } from '../crypto/vault-key.js';

interface KeyringState {
  userKey: Uint8Array;
  privateKey: CryptoKey;
  /** vaultId -> (keyVersion -> vault key) */
  vaultKeys: Map<string, Map<number, Uint8Array>>;
}

let state: KeyringState | null = null;
const listeners = new Set<(unlocked: boolean) => void>();

function notify(): void {
  for (const listener of listeners) listener(state !== null);
}

export function onLockStateChange(listener: (unlocked: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const isUnlocked = (): boolean => state !== null;

export async function unlock(params: {
  stretchedMasterKey: Uint8Array;
  wrappedUserKey: Envelope<WrappedKey>;
  wrappedPrivateKey: Envelope<WrappedKey>;
}): Promise<void> {
  const userKey = await unwrapUserKey(params.stretchedMasterKey, params.wrappedUserKey);
  const privateKey = await unwrapPrivateKey(userKey, params.wrappedPrivateKey);
  state = { userKey, privateKey, vaultKeys: new Map() };
  notify();
}

function requireState(): KeyringState {
  if (!state) throw new Error('Vault is locked');
  return state;
}

/** Personal vaults: the wrap is under the UserKey. */
export async function addSymmetricVaultKey(
  vaultId: string,
  keyVersion: number,
  wrapped: Envelope<WrappedKey>,
): Promise<void> {
  const s = requireState();
  const key = await unwrapVaultKeySymmetric(s.userKey, wrapped);
  addKey(s, vaultId, keyVersion, key);
}

/** Shared vaults: the wrap is to this member's RSA public key. */
export async function addMemberVaultKey(
  vaultId: string,
  keyVersion: number,
  wrapped: Envelope<WrappedKey>,
): Promise<void> {
  const s = requireState();
  const key = await unwrapVaultKeyForMember(s.privateKey, wrapped);
  addKey(s, vaultId, keyVersion, key);
}

function addKey(s: KeyringState, vaultId: string, keyVersion: number, key: Uint8Array): void {
  const byVersion = s.vaultKeys.get(vaultId) ?? new Map<number, Uint8Array>();
  byVersion.set(keyVersion, key);
  s.vaultKeys.set(vaultId, byVersion);
}

/** Reading: select by the ROW's generation, never the vault's current one. */
export function vaultKeyFor(vaultId: string, keyVersion: number): Uint8Array {
  const key = requireState().vaultKeys.get(vaultId)?.get(keyVersion);
  if (!key) throw new Error(`No key held for vault ${vaultId} generation ${keyVersion}`);
  return key;
}

/** Writing: always the highest generation held, so a rotation never chases its own tail. */
export function writeKeyFor(vaultId: string): { key: Uint8Array; keyVersion: number } {
  const byVersion = requireState().vaultKeys.get(vaultId);
  if (!byVersion || byVersion.size === 0) throw new Error(`No keys held for vault ${vaultId}`);
  const keyVersion = Math.max(...byVersion.keys());
  return { key: byVersion.get(keyVersion)!, keyVersion };
}

export function heldVersions(vaultId: string): number[] {
  return [...(state?.vaultKeys.get(vaultId)?.keys() ?? [])].sort((a, b) => a - b);
}

/**
 * Clears every key. Called on lock, sign-out, auto-lock, tab teardown, and on any
 * 401 REAUTH_REQUIRED — after a password change elsewhere, the keys held here are stale.
 */
export function lock(): void {
  if (!state) return;
  state.userKey.fill(0);
  for (const byVersion of state.vaultKeys.values()) {
    for (const key of byVersion.values()) key.fill(0);
  }
  state = null;
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', lock);
  window.addEventListener('beforeunload', lock);
}
