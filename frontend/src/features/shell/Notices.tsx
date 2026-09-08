/**
 * The one notice slot, at the top of the list column (T025, FR-020, FR-020b).
 *
 * Three notices used to stack above everything and push the vault below the fold — which is the
 * problem this redesign exists to solve. At most one shows now, in order of urgency: an offline
 * session changes what is possible at all; an invitation is waiting on the user; verification can
 * wait, and says so itself.
 *
 * None of them is dismissible. Nothing in the application implements dismissal today — each
 * clears when the condition behind it clears — so a dismiss control would be a new capability,
 * which FR-001 forbids (FR-020b).
 *
 * Copy is carried over verbatim. These are the strings that explain what the application can and
 * cannot do right now, and FR-002 does not allow them to be reworded.
 */
import { useState } from 'react';
import { CloudOff } from 'lucide-react';
import { Icon } from '../../components/Icon.js';
import { IncomingInvitations } from '../sharing/IncomingInvitations.js';
import { VerifyBanner } from '../settings/VerifyEmail.js';
import type { VaultWithName } from '../vault-list/vault-name.js';

export interface NoticesProps {
  offline: boolean;
  vaults: VaultWithName[];
  onInvitationResponded: () => Promise<void>;
}

export function Notices({ offline, vaults, onInvitationResponded }: NoticesProps) {
  const [hasInvitations, setHasInvitations] = useState(false);

  if (offline) {
    return (
      <p role="status" style={notice}>
        <Icon icon={CloudOff} size={15} style={{ marginTop: 2 }} />
        <span>
          <strong>Offline — reading only.</strong> This is the encrypted copy stored on this
          device. Creating, editing, deleting, and sharing need a connection, and nothing is
          queued, so reconnect before making changes.
        </span>
      </p>
    );
  }

  return (
    <>
      <IncomingInvitations
        vaults={vaults}
        onResponded={onInvitationResponded}
        onHasContent={setHasInvitations}
      />
      {/* Verification yields to an invitation: the invitation is waiting on a decision, and
          the verification notice explains that nothing is blocked on it. */}
      {!hasInvitations && <VerifyBanner />}
    </>
  );
}

const notice: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  margin: 0,
  padding: '11px 14px',
  borderRadius: 16,
  background: 'var(--color-accent-200)',
  color: 'var(--color-accent-800)',
  fontSize: 12.5,
  lineHeight: 1.45,
};
