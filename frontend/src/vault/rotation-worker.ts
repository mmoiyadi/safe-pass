/**
 * Client-side rotation worker (T097, FR-081 to FR-084).
 *
 * Re-encryption has to happen here because the server holds no key. The worker runs in the
 * background on the revoking Owner's device: the vault stays readable and writable throughout,
 * and an interruption resumes from the server's cursor rather than starting over.
 *
 * The order below is deliberate. Secrets go first because they are the bulk and the only thing
 * cursored; folder names, tag names, and the vault's own name go last, in a single batch. All
 * four must reach the new generation before `close` will succeed — closing on the secrets alone
 * would delete the only key that opens the other three, silently and permanently.
 */
import type {
  FolderName,
  Rotation,
  SecretFieldValue,
  SecretRecord,
  SecretTitle,
  TagName,
  VaultName,
} from '@pm/shared';
import { api, ApiError } from '../api/client.js';
import { decrypt, encrypt } from '../crypto/envelope.js';
import { generateVaultKey, wrapVaultKeyForMember } from '../crypto/vault-key.js';
import { importPublicKey } from '../crypto/user-key.js';
import { addSymmetricVaultKey, addMemberVaultKey, vaultKeyFor } from './keyring.js';

/** Small enough that one failed batch loses little; large enough not to be chatty. */
const BATCH_SIZE = 50;

export interface RotationProgress {
  state: 'opening' | 'secrets' | 'metadata' | 'closing' | 'done' | 'failed';
  done: number;
  total: number;
  message: string;
}

type OnProgress = (progress: RotationProgress) => void;

interface Member {
  userId: string;
  email: string;
  status: string;
}

/**
 * Opens a rotation: generates the next vault key and wraps it for every remaining member.
 *
 * Every active or invited member must get a wrap, or closing the rotation would lock them out.
 * The server enforces that too, but doing it here means the failure is caught before any
 * re-encryption work is wasted.
 */
export async function openRotation(
  vaultId: string,
  toVersion: number,
  onProgress?: OnProgress,
): Promise<{ rotation: Rotation; newKey: Uint8Array }> {
  onProgress?.({ state: 'opening', done: 0, total: 0, message: 'Preparing a new vault key…' });

  const newKey = generateVaultKey();
  const members = await api<Member[]>('GET', `/vaults/${vaultId}/members`);
  const remaining = members.filter((m) => m.status === 'active' || m.status === 'invited');

  const memberKeys = [];
  for (const member of remaining) {
    const { publicKey } = await api<{ publicKey: string }>(
      'GET',
      `/users/public-key?email=${encodeURIComponent(member.email)}`,
    );
    memberKeys.push({
      userId: member.userId,
      wrappedVaultKey: await wrapVaultKeyForMember(await importPublicKey(publicKey), newKey),
    });
  }

  const rotation = await api<Rotation>('POST', `/vaults/${vaultId}/rotation`, {
    toVersion,
    memberKeys,
  });

  return { rotation, newKey };
}

/**
 * Runs, or resumes, the re-encryption for an open rotation.
 *
 * Safe to call again after an interruption: it re-reads what is still at the old generation
 * rather than trusting anything it remembered.
 */
export async function runRotation(
  vaultId: string,
  fromVersion: number,
  toVersion: number,
  newKey: Uint8Array,
  onProgress?: OnProgress,
): Promise<void> {
  const oldKey = vaultKeyFor(vaultId, fromVersion);
  let done = 0;

  /* ------------------------------- secrets ------------------------------- */
  const secrets = await api<SecretRecord[]>('GET', `/vaults/${vaultId}/secrets`);
  const stale = secrets.filter((s) => s.keyVersion === fromVersion);

  const folders = await api<Array<{ id: string; name: string; keyVersion: number }>>(
    'GET',
    `/vaults/${vaultId}/folders`,
  );
  const tags = await api<Array<{ id: string; name: string; keyVersion: number }>>(
    'GET',
    `/vaults/${vaultId}/tags`,
  );
  const staleFolders = folders.filter((f) => f.keyVersion === fromVersion);
  const staleTags = tags.filter((t) => t.keyVersion === fromVersion);

  const total = stale.length + staleFolders.length + staleTags.length + 1; // +1 for the vault name

  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    const slice = stale.slice(i, i + BATCH_SIZE);
    const batch = [];

    for (const row of slice) {
      const fieldValues: Record<string, string> = {};
      for (const [fieldId, envelope] of Object.entries(row.fieldValues)) {
        fieldValues[fieldId] = await encrypt<SecretFieldValue>(newKey, await decrypt(oldKey, envelope));
      }
      batch.push({
        id: row.id,
        title: await encrypt<SecretTitle>(newKey, await decrypt(oldKey, row.title)),
        fieldValues,
      });
    }

    await api('POST', `/vaults/${vaultId}/rotation/batch`, { toVersion, secrets: batch });
    done += slice.length;
    onProgress?.({
      state: 'secrets',
      done,
      total,
      message: `Re-encrypting secrets — ${done} of ${total}`,
    });
  }

  /* -------------------- folders, tags, and the vault name ------------------- */
  // Few enough to send together, and not cursored: if this batch is lost, `close` refuses and
  // the worker simply sends it again.
  onProgress?.({ state: 'metadata', done, total, message: 'Re-encrypting folder and tag names…' });

  const vaults = await api<Array<{ id: string; name: string; nameKeyVersion: number }>>('GET', '/vaults');
  const vault = vaults.find((v) => v.id === vaultId);

  const metadata: Record<string, unknown> = { toVersion };
  if (staleFolders.length > 0) {
    metadata['folders'] = await Promise.all(
      staleFolders.map(async (f) => ({
        id: f.id,
        name: await encrypt<FolderName>(newKey, await decrypt(oldKey, f.name as never)),
      })),
    );
  }
  if (staleTags.length > 0) {
    metadata['tags'] = await Promise.all(
      staleTags.map(async (t) => ({
        id: t.id,
        name: await encrypt<TagName>(newKey, await decrypt(oldKey, t.name as never)),
      })),
    );
  }
  if (vault && vault.nameKeyVersion === fromVersion) {
    metadata['vaultName'] = await encrypt<VaultName>(newKey, await decrypt(oldKey, vault.name as never));
  }

  if (Object.keys(metadata).length > 1) {
    await api('POST', `/vaults/${vaultId}/rotation/batch`, metadata);
    done = total;
  }

  /* -------------------------------- close -------------------------------- */
  onProgress?.({ state: 'closing', done, total, message: 'Retiring the old key…' });

  try {
    await api('POST', `/vaults/${vaultId}/rotation/close`);
  } catch (error) {
    // A refusal here is the safety check working: something is still at the old generation.
    // Surfacing it as a failure is right — the alternative is a caller that believes the old
    // key is retired when it is not.
    if (error instanceof ApiError && error.code === 'ROTATION_IN_PROGRESS') {
      onProgress?.({
        state: 'failed',
        done,
        total,
        message:
          'Some items are still encrypted with the previous key, so it has not been retired. ' +
          'Run the rotation again to finish.',
      });
      throw error;
    }
    throw error;
  }

  onProgress?.({ state: 'done', done: total, total, message: 'The previous key has been retired.' });
}

/**
 * The whole sequence, for the common case: revoke, then rotate.
 *
 * The caller keeps the vault usable throughout; this only reports progress.
 */
export async function rotateVault(
  vaultId: string,
  currentVersion: number,
  personal: boolean,
  onProgress?: OnProgress,
): Promise<void> {
  const toVersion = currentVersion + 1;
  try {
    const { newKey } = await openRotation(vaultId, toVersion, onProgress);

    // Hold the new generation alongside the old one, so reads keep working while the job runs.
    const vaults = await api<Array<{ id: string; keyWraps: Array<{ keyVersion: number; wrappedVaultKey: string }> }>>(
      'GET',
      '/vaults',
    );
    const wrap = vaults
      .find((v) => v.id === vaultId)
      ?.keyWraps.find((w) => w.keyVersion === toVersion);
    if (wrap) {
      if (personal) await addSymmetricVaultKey(vaultId, toVersion, wrap.wrappedVaultKey as never);
      else await addMemberVaultKey(vaultId, toVersion, wrap.wrappedVaultKey as never);
    }

    await runRotation(vaultId, currentVersion, toVersion, newKey, onProgress);
  } catch (error) {
    onProgress?.({
      state: 'failed',
      done: 0,
      total: 0,
      message: error instanceof Error ? error.message : 'The rotation could not be completed.',
    });
    throw error;
  }
}

/** Resumes an interrupted rotation, if one is open. Returns false when there is nothing to do. */
export async function resumeRotationIfOpen(vaultId: string, personal: boolean, onProgress?: OnProgress): Promise<boolean> {
  let rotation: Rotation;
  try {
    rotation = await api<Rotation>('GET', `/vaults/${vaultId}/rotation`);
  } catch {
    return false;
  }
  if (rotation.state !== 'running') return false;

  // The new key is not recoverable from here — it was generated on whichever device opened the
  // rotation. This device can only continue if it already holds a wrap for the new generation.
  const vaults = await api<Array<{ id: string; keyWraps: Array<{ keyVersion: number; wrappedVaultKey: string }> }>>(
    'GET',
    '/vaults',
  );
  const wrap = vaults
    .find((v) => v.id === vaultId)
    ?.keyWraps.find((w) => w.keyVersion === rotation.toVersion);
  if (!wrap) return false;

  if (personal) await addSymmetricVaultKey(vaultId, rotation.toVersion, wrap.wrappedVaultKey as never);
  else await addMemberVaultKey(vaultId, rotation.toVersion, wrap.wrappedVaultKey as never);

  await runRotation(
    vaultId,
    rotation.fromVersion,
    rotation.toVersion,
    vaultKeyFor(vaultId, rotation.toVersion),
    onProgress,
  );
  return true;
}
