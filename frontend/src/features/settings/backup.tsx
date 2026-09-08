/**
 * Encrypted backup and restore (T131, FR-060 to FR-064).
 *
 * ## What the file is
 *
 * The vault's ciphertext exactly as the server holds it, plus the wrapped keys needed to open
 * it. Nothing in the file is readable without the master password that was in force when the
 * backup was taken — which is the single most important thing to tell the user, because it is
 * the one property that surprises people. They change their password, reach for a year-old
 * backup, and find it wants the old one. Saying so at the moment of download, and again at the
 * moment of a password change, is the difference between a safeguard and a trap (FR-064).
 *
 * ## Why the assembly happens here and not on the server
 *
 * The server has no key material, so it cannot add the wrapped keyring — it does not hold the
 * user's `wrappedPrivateKey` in a form tied to this download, and more importantly the file
 * should be assembled by the party that understands what makes it openable. The server's job is
 * to hand over ciphertext; the client's is to package it.
 */
import { useRef, useState } from 'react';
import type { Keyring, VaultSummary } from '@pm/shared';
import { api } from '../../api/client.js';

/** Bumped only if the shape changes in a way an older reader could misinterpret. */
const FORMAT_VERSION = 1;

interface VaultExport {
  formatVersion: number;
  exportedAt: string;
  vault: { name: string; kind: string; keyVersion: number };
  keyWraps: Array<{ keyVersion: number; wrappedVaultKey: string }>;
  secrets: unknown[];
  folders: unknown[];
  tags: unknown[];
  templates: unknown[];
}

interface BackupFile extends VaultExport {
  /** The account the backup was taken from — the Argon2id salt input, not a secret. */
  email: string;
  /** Wrapped, therefore useless without the master password of the time (FR-062). */
  keyring: Keyring;
}

export function Backup({
  email,
  vaults,
  keyring,
  onRestored,
}: {
  email: string;
  vaults: VaultSummary[];
  keyring: Keyring | null;
  onRestored: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Only vaults the user owns: exporting a shared vault is the Owner's call, and the server
  // enforces it regardless of what this list offers (FR-065).
  const exportable = vaults.filter((v) => v.role === 'owner' && v.status === 'active');

  async function download(vault: VaultSummary) {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      if (!keyring) throw new Error('Sign in again before taking a backup.');

      const bundle = await api<VaultExport>('GET', `/vaults/${vault.id}/export`);
      const file: BackupFile = { ...bundle, formatVersion: FORMAT_VERSION, email, keyring };

      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);

      setNote(
        `Backup saved. It opens only with the master password you are using right now — if you ` +
          `change your password later, this file will still want the current one.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take a backup.');
    } finally {
      setBusy(false);
    }
  }

  async function restore(chosen: File) {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const parsed = JSON.parse(await chosen.text()) as Partial<BackupFile>;
      if (parsed.formatVersion !== FORMAT_VERSION || !Array.isArray(parsed.secrets)) {
        throw new Error('That does not look like a backup file from this application.');
      }

      // Restoring a backup taken under a different master password would need that password to
      // unwrap the keys, and there is no way to ask for one password to open a file and another
      // to hold the result. Refusing is honest; a half-restored vault would not be.
      if (parsed.email !== email) {
        throw new Error(
          `This backup was taken from ${parsed.email ?? 'another account'}. Restoring it here ` +
            `would need that account's master password.`,
        );
      }

      const restored = await api<{ id: string; secrets: number }>('POST', '/vaults/import', {
        name: parsed.vault!.name,
        // The vault key is already wrapped for this account in the backup's own keyWraps: the
        // backup came from here, so the wrap is still one this device can open.
        wrappedVaultKey: parsed.keyWraps![0]!.wrappedVaultKey,
        secrets: parsed.secrets,
        folders: parsed.folders ?? [],
        tags: parsed.tags ?? [],
        templates: parsed.templates ?? [],
      });

      setNote(
        `Restored ${restored.secrets} secret${restored.secrets === 1 ? '' : 's'} into a new ` +
          `vault. Nothing that was already here was touched.`,
      );
      await onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore that file.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <section>
      <h3>Backup</h3>

      <p style={note_}>
        A backup holds your vault exactly as the server does — encrypted. Keeping one is the only
        protection against an accidental deletion, because deleting a secret here is permanent and
        there is no trash to recover it from.
      </p>
      <p style={{ ...note_, color: 'var(--warn)' }}>
        <strong>A backup opens only with the master password in force when you took it.</strong>{' '}
        Change your password and older files will still want the old one, so keep a note of when
        each was taken.
      </p>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {note && <p style={{ color: 'var(--accent)' }}>{note}</p>}

      <h3 style={heading}>Download</h3>
      {exportable.length === 0 ? (
        <p style={note_}>You do not own a vault to back up.</p>
      ) : (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {exportable.map((vault) => (
            <button
              key={vault.id}
              type="button"
              disabled={busy}
              onClick={() => void download(vault)}
              style={secondary}
            >
              Back up {vault.kind === 'personal' ? 'my personal vault' : 'this shared vault'}
            </button>
          ))}
        </div>
      )}

      <h3 style={heading}>Restore</h3>
      <p style={note_}>
        A restore lands as a <strong>new vault</strong>. Nothing already in your account is
        replaced or overwritten, so a restore can never destroy what is here — if it turns out to
        be the wrong file, delete the vault it created.
      </p>
      {/*
        Labelled explicitly. A bare file input is announced as "button" with no indication of
        what it takes — and this one restores a vault, which is not a control to leave
        ambiguous. Caught by tests/e2e/a11y.spec.ts.
      */}
      <label style={{ display: 'block', fontSize: '0.92rem' }}>
        Choose a backup file
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) void restore(chosen);
          }}
          style={{ display: 'block', marginTop: '0.35rem', fontSize: '0.9rem' }}
        />
      </label>
    </section>
  );
}

const heading: React.CSSProperties = { fontSize: '1rem', margin: '1.1rem 0 0.4rem' };
const note_: React.CSSProperties = { color: 'var(--muted)', fontSize: '0.92rem', margin: '0 0 0.6rem' };

const secondary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};
