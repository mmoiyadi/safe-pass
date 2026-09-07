/**
 * The encrypted offline vault cache (T126, T127, FR-054 to FR-059).
 *
 * ## What this is allowed to hold
 *
 * Exactly what the server already holds, and nothing more: ciphertext, and keys that are
 * themselves wrapped. Never a derived key, never the master password, never a decrypted value.
 * The rule is simple enough to check by eye and is checked mechanically in
 * `tests/crypto/offline-cache.test.ts`, which walks the whole database and asserts no derived
 * key and no plaintext appears in it.
 *
 * That rule is what makes the feature acceptable at all. Caching a vault on the device is real
 * new exposure compared with an online-only design — a stolen laptop now carries a copy of the
 * vault. Holding only ciphertext means the thief still needs the master password, so the theft
 * is no worse than a theft of the server's own database (research.md §6).
 *
 * ## Why it still expires
 *
 * Because "no worse than the server's database" is not the same as "free". A copy that lives
 * forever on a device the user has stopped using is exposure with no remaining benefit, so it
 * is discarded after 30 days, on sign-out, on revocation, and whenever the user turns offline
 * access off (FR-058, FR-059).
 *
 * ## Why IndexedDB
 *
 * It stores structured data natively and is asynchronous. `localStorage` would force base64
 * inflation of binary ciphertext and block the main thread (research.md §6).
 */
import type { Envelope, Role, SecretTitle, TemplateVersionRecord, VaultName, WrappedKey } from '@pm/shared';

const DB_NAME = 'pm-offline';
const DB_VERSION = 1;
const STORE = 'snapshot';
/** One row: the cache holds a single account, so signing in as someone else replaces it. */
const SNAPSHOT_KEY = 'current';
const SETTINGS_KEY = 'settings';

/**
 * 30 days (FR-058). Long enough that a fortnight away from the network does not cost the user
 * their vault; short enough that a forgotten device stops being a copy of it.
 */
export const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedSecret {
  id: string;
  templateVersionId: string;
  keyVersion: number;
  revision: number;
  folderId: string | null;
  tagIds: string[];
  title: Envelope<SecretTitle>;
  fieldValues: Record<string, string>;
}

export interface CachedNamed {
  id: string;
  keyVersion: number;
  name: string;
}

export interface CachedVault {
  id: string;
  kind: 'personal' | 'standard';
  name: Envelope<VaultName>;
  keyVersion: number;
  nameKeyVersion: number;
  role: Role;
  keyWraps: Array<{ keyVersion: number; wrappedVaultKey: string }>;
  secrets: CachedSecret[];
  folders: CachedNamed[];
  tags: CachedNamed[];
  /** Cached so an offline secret can still be rendered by its template (FR-054). */
  templates: TemplateVersionRecord[];
}

export interface OfflineSnapshot {
  /**
   * Identifies whose cache this is. An email address is not a secret — the server knows it, and
   * it is typed into the unlock form anyway — but it IS the Argon2id salt input, so the cache
   * must belong to exactly one account and refuse to serve any other.
   */
  email: string;
  refreshedAt: number;
  keyring: {
    wrappedUserKey: Envelope<WrappedKey>;
    wrappedPrivateKey: Envelope<WrappedKey>;
    publicKey: string;
  };
  vaults: CachedVault[];
}

/* ------------------------------------------------------------------ *
 * IndexedDB plumbing
 * ------------------------------------------------------------------ */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the offline cache'));
  });
}

async function read<T>(key: string): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function write(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function remove(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ *
 * The per-device off switch (FR-059)
 * ------------------------------------------------------------------ */

export async function isOfflineEnabled(): Promise<boolean> {
  const settings = await read<{ enabled: boolean }>(SETTINGS_KEY);
  // On unless the user has said otherwise: offline reading is the feature, and a user who has
  // never expressed a preference gets it.
  return settings?.enabled !== false;
}

/** Turning it off must take effect immediately, including on any copy already held. */
export async function setOfflineEnabled(enabled: boolean): Promise<void> {
  await write(SETTINGS_KEY, { enabled });
  if (!enabled) await remove(SNAPSHOT_KEY);
}

/* ------------------------------------------------------------------ *
 * Reading and writing the snapshot
 * ------------------------------------------------------------------ */

/**
 * Replaces the cached snapshot.
 *
 * A no-op while offline access is off, so turning it off cannot be silently undone by the next
 * successful sign-in.
 */
export async function saveSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  if (!(await isOfflineEnabled())) return;
  await write(SNAPSHOT_KEY, snapshot);
}

/**
 * The snapshot for this account, or null if there is none, it belongs to someone else, or it
 * has gone stale.
 *
 * An expired snapshot is deleted here rather than merely hidden: keeping stale ciphertext on
 * the device would carry the whole exposure and provide none of the benefit.
 */
export async function loadSnapshot(email: string): Promise<OfflineSnapshot | null> {
  if (!(await isOfflineEnabled())) return null;

  const snapshot = await read<OfflineSnapshot>(SNAPSHOT_KEY);
  if (!snapshot) return null;

  if (snapshot.email !== email) return null;

  if (Date.now() - snapshot.refreshedAt > MAX_CACHE_AGE_MS) {
    await remove(SNAPSHOT_KEY);
    return null;
  }

  return snapshot;
}

/** How stale the held copy is, for telling the user what they are reading. */
export async function cacheAge(email: string): Promise<number | null> {
  const snapshot = await loadSnapshot(email);
  return snapshot ? Date.now() - snapshot.refreshedAt : null;
}

/**
 * Drops one vault from the cache, leaving the rest.
 *
 * Used when access is revoked. The device keeps reading its copy until it next reaches the
 * network — that is inherent to offline access and is documented rather than papered over
 * (research.md §6) — but the moment it does reach the network, the copy goes.
 */
export async function discardVault(email: string, vaultId: string): Promise<void> {
  const snapshot = await read<OfflineSnapshot>(SNAPSHOT_KEY);
  if (!snapshot || snapshot.email !== email) return;
  await write(SNAPSHOT_KEY, {
    ...snapshot,
    vaults: snapshot.vaults.filter((v) => v.id !== vaultId),
  });
}

/** Sign-out, lock-out, or switching account. Leaves the user's on/off preference intact. */
export async function discardAll(): Promise<void> {
  await remove(SNAPSHOT_KEY);
}
