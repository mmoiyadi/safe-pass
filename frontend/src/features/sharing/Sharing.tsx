/**
 * Sharing (T099, T100, T101, T102).
 *
 * Inviting has two outcomes and the interface has to be honest about which one happened. If the
 * address has an account, the vault key is wrapped to their public key here and they get access
 * as soon as they accept. If it does not, nothing is granted and nothing is stored that could
 * grant anything — the invitation waits until they register and an Owner comes back to finish
 * it. Telling someone "invited" in both cases would leave them believing access exists when it
 * does not.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Invitation, Membership, Role, Rotation } from '@pm/shared';
import { api, ApiError } from '../../api/client.js';
import { importPublicKey } from '../../crypto/user-key.js';
import { wrapVaultKeyForMember } from '../../crypto/vault-key.js';
import { vaultKeyFor } from '../../vault/keyring.js';
import { rotateVault, type RotationProgress } from '../../vault/rotation-worker.js';

interface ActivityEntry {
  id: string;
  action: string;
  actorEmail: string | null;
  at: string;
  metadata: Record<string, unknown> | null;
}

export function Sharing({
  vaultId,
  keyVersion,
  personal,
  myRole,
  onChanged,
}: {
  vaultId: string;
  keyVersion: number;
  personal: boolean;
  myRole: Role;
  onChanged: () => Promise<void>;
}) {
  const [members, setMembers] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [rotation, setRotation] = useState<Rotation | null>(null);
  const [progress, setProgress] = useState<RotationProgress | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'pending' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const isOwner = myRole === 'owner';

  const load = useCallback(async () => {
    if (personal) return;
    const [activityRows] = await Promise.all([
      api<ActivityEntry[]>('GET', `/vaults/${vaultId}/activity`),
    ]);
    setActivity(activityRows);

    if (isOwner) {
      setMembers(await api<Membership[]>('GET', `/vaults/${vaultId}/members`));
      setInvitations(await api<Invitation[]>('GET', `/vaults/${vaultId}/invitations`));
    }

    try {
      setRotation(await api<Rotation>('GET', `/vaults/${vaultId}/rotation`));
    } catch {
      setRotation(null);
    }
  }, [vaultId, personal, isOwner]);

  useEffect(() => void load().catch(() => {}), [load]);

  if (personal) {
    return (
      <section>
        <h2>Sharing</h2>
        <p style={{ color: 'var(--muted)' }}>
          Your personal vault is private and cannot be shared. Create another vault to share with
          someone.
        </p>
      </section>
    );
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setBusy(true);
    try {
      // Look up the public key first. A 404 means no account — and the lookup answers
      // identically for "unknown" and "unverified", so this cannot be used to probe.
      let publicKey: string | null = null;
      try {
        publicKey = (
          await api<{ publicKey: string }>('GET', `/users/public-key?email=${encodeURIComponent(email)}`)
        ).publicKey;
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }

      if (publicKey) {
        // The vault key is wrapped HERE, to their public key. The server carries it and cannot
        // read it, and neither party learns anything about the other's password.
        const wrapped = await wrapVaultKeyForMember(
          await importPublicKey(publicKey),
          vaultKeyFor(vaultId, keyVersion),
        );
        await api('POST', `/vaults/${vaultId}/members`, { email, role, wrappedVaultKey: wrapped });
        setNotice({ kind: 'ok', text: `${email} has been invited and can accept straight away.` });
      } else {
        await api('POST', `/vaults/${vaultId}/members`, { email, role });
        setNotice({
          kind: 'pending',
          text:
            `${email} has no account yet, so nothing has been shared. We have stored an ` +
            `invitation that grants nothing — their vault key cannot be created until they have ` +
            `a key of their own. Once they register, come back here to finish it.`,
        });
      }
      setEmail('');
      await load();
      await onChanged();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not invite.' });
    } finally {
      setBusy(false);
    }
  }

  async function completeInvitation(invitation: Invitation) {
    setBusy(true);
    setNotice(null);
    try {
      const { publicKey } = await api<{ publicKey: string }>(
        'GET',
        `/users/public-key?email=${encodeURIComponent(invitation.inviteeEmail)}`,
      );
      const wrapped = await wrapVaultKeyForMember(
        await importPublicKey(publicKey),
        vaultKeyFor(vaultId, keyVersion),
      );
      await api('POST', `/vaults/${vaultId}/invitations/${invitation.id}/complete`, {
        wrappedVaultKey: wrapped,
        keyVersion,
      });
      setNotice({ kind: 'ok', text: `${invitation.inviteeEmail} can now accept.` });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not complete.' });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(member: Membership) {
    const confirmed = window.confirm(
      `Remove ${member.email} from this vault?\n\n` +
        `They lose access immediately. The vault's key will then be replaced and everything in ` +
        `it re-encrypted, which stops them reading anything NEW — but it cannot un-read what ` +
        `they already saw while they had access.`,
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      await api('DELETE', `/vaults/${vaultId}/members/${member.userId}`);
      setNotice({
        kind: 'ok',
        text: `${member.email} was removed and is already refused. Re-encrypting the vault now.`,
      });
      await load();
      // Rotation runs in the background; the vault stays usable throughout.
      await rotateVault(vaultId, keyVersion, personal, setProgress);
      await load();
      await onChanged();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Revocation failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Sharing</h2>

      {/* FR-084: a persistent indication while the old key is still in play. */}
      {(rotation || progress) && progress?.state !== 'done' && (
        <div style={banner}>
          <strong>Re-encrypting this vault</strong>
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.9rem' }}>
            {progress?.message ??
              `${rotation?.doneCount ?? 0} of ${rotation?.totalCount ?? 0} items rewritten.`}{' '}
            Until this finishes, anyone removed can still read data they had already downloaded —
            re-encryption limits what they can read <em>in future</em>, and cannot undo what they
            already saw.
          </p>
        </div>
      )}

      {notice && (
        <p
          style={{
            color:
              notice.kind === 'error'
                ? 'var(--danger)'
                : notice.kind === 'pending'
                  ? 'var(--warn)'
                  : 'var(--accent)',
            fontSize: '0.92rem',
          }}
        >
          {notice.text}
        </p>
      )}

      {isOwner && (
        <>
          <h3 style={heading}>Invite someone</h3>
          <form onSubmit={invite} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="their email address"
              required
              autoComplete="off"
              style={{ ...input, flex: '1 1 16rem' }}
            />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} style={input}>
              <option value="viewer">Viewer — read only</option>
              <option value="editor">Editor — can change secrets</option>
              <option value="owner">Owner — can manage members</option>
            </select>
            <button type="submit" disabled={busy || !email.includes('@')} style={primary(!busy && email.includes('@'))}>
              Invite
            </button>
          </form>

          <h3 style={heading}>Members</h3>
          <ul style={list}>
            {members.map((m) => (
              <li key={m.userId} style={row}>
                <span>{m.email}</span>
                <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                  {m.role}
                  {m.status !== 'active' && ` · ${m.status}`}
                  {m.keyVersions.length > 1 && ' · holds both keys'}
                </span>
                <button type="button" onClick={() => void revoke(m)} disabled={busy} style={dangerLink}>
                  Remove
                </button>
              </li>
            ))}
            {members.length === 0 && <li style={{ color: 'var(--muted)' }}>Just you.</li>}
          </ul>

          {invitations.length > 0 && (
            <>
              <h3 style={heading}>Waiting on someone</h3>
              <p style={note}>
                These people had no account when you invited them, so nothing was shared. We hold
                no key for them — one cannot exist until they have a key of their own.
              </p>
              <ul style={list}>
                {invitations.map((i) => (
                  <li key={i.id} style={row}>
                    <span>{i.inviteeEmail}</span>
                    <span style={{ color: i.state === 'ready' ? 'var(--accent)' : 'var(--muted)', fontSize: '0.85rem' }}>
                      {i.state === 'ready' ? 'has registered — ready to finish' : 'waiting for them to register'}
                    </span>
                    <span style={{ display: 'flex', gap: '0.6rem' }}>
                      {i.state === 'ready' && (
                        <button
                          type="button"
                          onClick={() => void completeInvitation(i)}
                          disabled={busy}
                          style={{ ...dangerLink, color: 'var(--accent)' }}
                        >
                          Finish
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          await api('DELETE', `/vaults/${vaultId}/invitations/${i.id}`);
                          await load();
                        }}
                        style={dangerLink}
                      >
                        Withdraw
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <h3 style={heading}>Activity</h3>
      <p style={note}>
        Append-only — entries cannot be edited or removed, including by us.
      </p>
      <ul style={list}>
        {activity.map((entry) => (
          <li key={entry.id} style={{ ...row, gridTemplateColumns: '1fr auto' }}>
            <span>
              {describe(entry.action)}
              {entry.actorEmail && <span style={{ color: 'var(--muted)' }}> — {entry.actorEmail}</span>}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
              {new Date(entry.at).toLocaleString()}
            </span>
          </li>
        ))}
        {activity.length === 0 && <li style={{ color: 'var(--muted)' }}>Nothing recorded yet.</li>}
      </ul>
    </section>
  );
}

/** Plain language for the log. A raw action name is not something to put in front of a user. */
function describe(action: string): string {
  const words: Record<string, string> = {
    vault_created: 'Vault created',
    vault_deleted: 'Vault deleted',
    invited: 'Someone was invited',
    invitation_ready: 'An invited person registered',
    invitation_completed: 'An invitation was completed',
    invitation_withdrawn: 'An invitation was withdrawn',
    invitation_expired: 'An invitation expired',
    accepted: 'An invitation was accepted',
    declined: 'An invitation was declined',
    revoked: 'A member was removed',
    role_changed: 'A role was changed',
    rotation_started: 'Re-encryption started',
    rotation_completed: 'Re-encryption finished; the previous key was retired',
    secret_deleted: 'A secret was permanently deleted',
    exported: 'The vault was exported',
  };
  return words[action] ?? action;
}

const heading: React.CSSProperties = { fontSize: '1rem', margin: '1.25rem 0 0.3rem' };
const note: React.CSSProperties = { color: 'var(--muted)', fontSize: '0.88rem', margin: '0 0 0.5rem' };
const list: React.CSSProperties = { listStyle: 'none', padding: 0, margin: '0 0 0.6rem' };

const row: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto',
  gap: '0.75rem',
  alignItems: 'center',
  padding: '0.4rem 0',
  borderBottom: '1px solid var(--border)',
  fontSize: '0.92rem',
};

const input: React.CSSProperties = {
  padding: '0.45rem 0.6rem',
  fontSize: '0.95rem',
  border: '1px solid var(--border)',
  borderRadius: 5,
  background: 'var(--bg)',
  color: 'var(--fg)',
};

const primary = (enabled: boolean): React.CSSProperties => ({
  padding: '0.45rem 0.9rem',
  borderRadius: 5,
  border: 'none',
  background: enabled ? 'var(--accent)' : 'var(--border)',
  color: enabled ? '#fff' : 'var(--muted)',
  cursor: enabled ? 'pointer' : 'not-allowed',
});

const dangerLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--danger)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.85rem',
};

const banner: React.CSSProperties = {
  border: '1px solid var(--warn)',
  borderRadius: 6,
  padding: '0.7rem 0.9rem',
  margin: '0 0 1rem',
};
