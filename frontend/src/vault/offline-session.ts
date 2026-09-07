/**
 * Unlocking and refreshing from the offline cache (T126, FR-054, FR-056).
 *
 * Two directions:
 *
 *  - **Refresh** runs after a successful online unlock. It copies the ciphertext the client has
 *    just fetched into IndexedDB, so the same vault opens later with no network.
 *  - **Unlock offline** runs when the server cannot be reached. Argon2id runs locally, unwraps
 *    the cached keys, and the vault opens from the cached ciphertext.
 *
 * The master password is required either way (FR-056): the cached keys are wrapped, so there is
 * no path from the cache to a readable secret that does not run the KDF first. The auto-lock
 * timer is started on the offline path exactly as on the online one — an unattended offline
 * device must not stay open longer than an online one would.
 */
import type { Keyring, TemplateVersionRecord, VaultSummary } from '@pm/shared';
import { deriveMasterKey } from '../crypto/kdf.js';
import { deriveStretchedMasterKey } from '../crypto/master-key.js';
import { addMemberVaultKey, addSymmetricVaultKey, unlock } from './keyring.js';
import { restartAutoLock } from './auto-lock.js';
import {
  discardAll,
  isOfflineEnabled,
  loadSnapshot,
  saveSnapshot,
  type CachedVault,
  type OfflineSnapshot,
} from './offline-cache.js';
import { api } from '../api/client.js';

/** The vaults the client holds, as fetched online, ready to be cached. */
export interface RefreshInput {
  email: string;
  keyring: Keyring;
  vaults: Array<VaultSummary & { keyWraps: Array<{ keyVersion: number; wrappedVaultKey: string }> }>;
}

/**
 * Copies the current vault contents into the cache.
 *
 * Best-effort by design: a device with no storage quota, or a user in a private window, should
 * still be able to use the vault online. A failure to cache is not a failure to sign in.
 */
export async function refreshOfflineCache(input: RefreshInput): Promise<void> {
  if (!(await isOfflineEnabled())) return;

  try {
    const vaults: CachedVault[] = [];

    for (const vault of input.vaults) {
      // Only vaults this device can actually open. An invitation not yet accepted carries no
      // key, so caching it would store ciphertext that nothing here could ever read.
      if (vault.status !== 'active') continue;

      const [secrets, folders, tags] = await Promise.all([
        api<CachedVault['secrets']>('GET', `/vaults/${vault.id}/secrets`),
        api<CachedVault['folders']>('GET', `/vaults/${vault.id}/folders`),
        api<CachedVault['tags']>('GET', `/vaults/${vault.id}/tags`),
      ]);

      vaults.push({
        id: vault.id,
        kind: vault.kind,
        name: vault.name,
        keyVersion: vault.keyVersion,
        nameKeyVersion: vault.nameKeyVersion,
        role: vault.role,
        keyWraps: vault.keyWraps,
        secrets,
        folders,
        tags,
        templates: [],
      });
    }

    // Templates are account-wide, so they are fetched once and attached to every vault. Without
    // them a cached secret would have nothing to render its fields offline.
    const templates = await api<TemplateVersionRecord[]>('GET', '/templates');

    /*
     * That list holds CURRENT versions only. A secret written under an earlier version needs
     * that earlier version to render, and offline there is no server to ask for it — so it is
     * resolved now, while the network is still here. Skipping this is not a subtle degradation:
     * the secret shows as "Unknown type" with none of its fields, which is precisely the
     * failure FR-040 exists to prevent, arriving by a different route.
     */
    const known = new Set(templates.map((t) => t.id));
    const needed = new Set<string>();
    for (const vault of vaults) {
      for (const secret of vault.secrets) {
        if (!known.has(secret.templateVersionId)) needed.add(secret.templateVersionId);
      }
    }

    const resolved = await Promise.all(
      [...needed].map((id) =>
        api<TemplateVersionRecord>('GET', `/templates/versions/${id}`).catch(() => null),
      ),
    );

    const all = [...templates, ...resolved.filter((t): t is TemplateVersionRecord => t !== null)];
    for (const vault of vaults) vault.templates = all;

    await saveSnapshot({
      email: input.email,
      refreshedAt: Date.now(),
      keyring: input.keyring,
      vaults,
    });
  } catch {
    // Caching is an optimisation. Never let it break the session it was meant to help.
  }
}

export interface OfflineUnlock {
  snapshot: OfflineSnapshot;
  vaults: VaultSummary[];
}

/**
 * Opens the cached vault with the master password.
 *
 * Returns null when there is nothing usable to open — no cache, a cache belonging to another
 * account, or one past the staleness limit — so the caller can say which of those it is rather
 * than showing a generic failure.
 */
export async function unlockOffline(
  email: string,
  masterPassword: string,
): Promise<OfflineUnlock | null> {
  const snapshot = await loadSnapshot(email);
  if (!snapshot) return null;

  const masterKey = await deriveMasterKey(masterPassword, email);
  const stretchedMasterKey = await deriveStretchedMasterKey(masterKey);

  try {
    // A wrong password fails here, in the unwrap, exactly as it would online. The cache never
    // gets a chance to verify a password itself — it holds nothing that could.
    await unlock({
      stretchedMasterKey,
      wrappedUserKey: snapshot.keyring.wrappedUserKey,
      wrappedPrivateKey: snapshot.keyring.wrappedPrivateKey,
    });
  } finally {
    masterKey.fill(0);
    stretchedMasterKey.fill(0);
  }

  for (const vault of snapshot.vaults) {
    for (const wrap of vault.keyWraps) {
      if (vault.kind === 'personal') {
        await addSymmetricVaultKey(vault.id, wrap.keyVersion, wrap.wrappedVaultKey as never);
      } else {
        await addMemberVaultKey(vault.id, wrap.keyVersion, wrap.wrappedVaultKey as never);
      }
    }
  }

  // The same auto-lock as online (FR-056): an idle device is idle whether or not it has a
  // network, and offline is not a reason to stay open longer.
  restartAutoLock();

  return {
    snapshot,
    vaults: snapshot.vaults.map((v) => ({
      id: v.id,
      name: v.name,
      kind: v.kind,
      keyVersion: v.keyVersion,
      nameKeyVersion: v.nameKeyVersion,
      role: v.role,
      status: 'active',
      rotationPending: false,
    })),
  };
}

/**
 * Discards the device's copy entirely.
 *
 * NOT called on lock: locking is the ordinary end of a session, and unlocking later without a
 * network is the whole point of holding the copy (FR-054). This is for the cases FR-058 names —
 * the user turning offline access off, and account removal.
 */
export async function forgetOfflineCopy(): Promise<void> {
  await discardAll();
}
