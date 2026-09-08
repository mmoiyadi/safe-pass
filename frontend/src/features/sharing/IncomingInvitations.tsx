/**
 * Invitations offered to the person looking at the screen.
 *
 * Two different things land here, and they are not the same:
 *
 *  - a vault where the key has already been wrapped to this person, waiting on them to accept.
 *    They can see its name, because they can already open it.
 *  - an invitation from before they had an account, where nothing has been wrapped yet. There
 *    is nothing to accept and nothing to see — an Owner has to finish it first, on their own
 *    device, because only they hold the vault key.
 *
 * Showing both as "invitations you can accept" would be a lie about the second.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import type { VaultWithName } from '../vault-list/vault-name.js';

interface AwaitingCompletion {
  id: string;
  role: string;
  state: string;
  invitedByEmail: string;
  expiresAt: string;
}

export function IncomingInvitations({
  vaults,
  onResponded,
  onHasContent,
}: {
  vaults: VaultWithName[];
  onResponded: () => Promise<void>;
  /**
   * Whether this notice has anything to show. `Notices` shows at most one notice at a time
   * (FR-020) and cannot tell without asking: half the answer is the fetched `awaiting` list,
   * which only this component holds.
   */
  onHasContent?: (has: boolean) => void;
}) {
  const [awaiting, setAwaiting] = useState<AwaitingCompletion[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAwaiting(await api<AwaitingCompletion[]>('GET', '/invitations'));
    } catch {
      setAwaiting([]);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const acceptable = vaults.filter((v) => v.status === 'invited');
  const hasContent = acceptable.length > 0 || awaiting.length > 0;

  useEffect(() => onHasContent?.(hasContent), [hasContent, onHasContent]);

  if (!hasContent) return null;

  async function respond(vaultId: string, action: 'accept' | 'decline') {
    setBusy(true);
    try {
      await api('POST', `/vaults/${vaultId}/members/${action}`);
      await onResponded();
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={panel}>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Shared with you</h2>

      {acceptable.map((vault) => (
        <div key={vault.id} style={row}>
          <span>
            <strong>{vault.decryptedName}</strong>
            <span style={{ color: 'var(--muted)' }}> — you have been given {vault.role} access</span>
          </span>
          <span style={{ display: 'flex', gap: '0.6rem' }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond(vault.id, 'accept')}
              style={accept}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond(vault.id, 'decline')}
              style={decline}
            >
              Decline
            </button>
          </span>
        </div>
      ))}

      {awaiting.map((invitation) => (
        <div key={invitation.id} style={row}>
          <span style={{ color: 'var(--muted)' }}>
            {invitation.invitedByEmail} invited you to a vault before you had an account.
            {' '}
            <strong>Nothing has been shared yet</strong> — they need to finish it from their own
            device, because only they hold the key.
          </span>
        </div>
      ))}
    </section>
  );
}

const panel: React.CSSProperties = {
  border: '1px solid var(--accent)',
  borderRadius: 6,
  padding: '0.75rem 0.9rem',
  marginBottom: '1rem',
};

const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '1rem',
  flexWrap: 'wrap',
  fontSize: '0.92rem',
  padding: '0.25rem 0',
};

const accept: React.CSSProperties = {
  padding: '0.3rem 0.75rem',
  borderRadius: 5,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
};

const decline: React.CSSProperties = {
  padding: '0.3rem 0.75rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};
