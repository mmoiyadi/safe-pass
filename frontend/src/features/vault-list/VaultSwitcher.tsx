/**
 * Vault switcher and creation (T098).
 *
 * A new vault's name is encrypted under its own fresh key, and that key is wrapped to the
 * creator's own public key — so the vault is created by the browser and the server only ever
 * receives two things it cannot open.
 */
import { useState, type FormEvent } from 'react';
import type { VaultName, VaultSummary } from '@pm/shared';
import { api } from '../../api/client.js';
import { encrypt } from '../../crypto/envelope.js';
import { generateVaultKey, wrapVaultKeyForMember } from '../../crypto/vault-key.js';
import { importPublicKey } from '../../crypto/user-key.js';
import { getKeyring } from '../../vault/session.js';

export interface VaultWithName extends VaultSummary {
  decryptedName: string;
}

export function VaultSwitcher({
  vaults,
  selectedId,
  onSelect,
  onCreated,
}: {
  vaults: VaultWithName[];
  selectedId: string;
  onSelect: (vaultId: string) => void;
  onCreated: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const keyring = getKeyring();
      if (!keyring) throw new Error('Sign in again to create a vault.');

      // A fresh key per vault: that is what lets one vault be re-keyed on revocation without
      // touching any other.
      const vaultKey = generateVaultKey();
      await api('POST', '/vaults', {
        name: await encrypt<VaultName>(vaultKey, name.trim()),
        wrappedVaultKey: await wrapVaultKeyForMember(
          await importPublicKey(keyring.publicKey),
          vaultKey,
        ),
      });

      setName('');
      setCreating(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the vault.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: 'var(--muted)', fontSize: '0.85rem', minWidth: '3.2rem' }}>Vault</span>
        {vaults.map((vault) => (
          <button
            key={vault.id}
            type="button"
            onClick={() => onSelect(vault.id)}
            aria-pressed={vault.id === selectedId}
            style={{
              padding: '0.2rem 0.6rem',
              fontSize: '0.85rem',
              borderRadius: 999,
              border: `1px solid ${vault.id === selectedId ? 'var(--accent)' : 'var(--border)'}`,
              background: vault.id === selectedId ? 'var(--accent)' : 'transparent',
              color: vault.id === selectedId ? '#fff' : 'var(--fg)',
              cursor: 'pointer',
            }}
          >
            {vault.decryptedName}
            {vault.kind === 'personal' && (
              <span style={{ opacity: 0.7, marginLeft: '0.35rem' }} title="Private to you">
                ·
              </span>
            )}
            {vault.rotationPending && (
              <span style={{ marginLeft: '0.35rem' }} title="Re-encryption in progress">
                ⟳
              </span>
            )}
          </button>
        ))}

        {!creating && (
          <button type="button" onClick={() => setCreating(true)} style={ghost}>
            + New vault
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vault name"
            autoFocus
            autoComplete="off"
            style={{
              flex: 1,
              padding: '0.45rem 0.6rem',
              fontSize: '0.95rem',
              border: '1px solid var(--border)',
              borderRadius: 5,
              background: 'var(--bg)',
              color: 'var(--fg)',
            }}
          />
          <button type="submit" disabled={busy || !name.trim()} style={ghost}>
            Create
          </button>
          <button type="button" onClick={() => setCreating(false)} style={ghost}>
            Cancel
          </button>
        </form>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{error}</p>}
    </div>
  );
}

const ghost: React.CSSProperties = {
  padding: '0.2rem 0.6rem',
  fontSize: '0.85rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};
