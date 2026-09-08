/**
 * Forgotten master password (T051, FR-011).
 *
 * This screen exists to say one thing clearly and not to soften it. There is no reset flow to
 * offer, so offering hope here would be a lie that wastes the user's time. The only action
 * available is deleting the account, and that is presented as the destructive act it is.
 */
import { useState } from 'react';
import { api } from '../../api/client.js';

export function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [stage, setStage] = useState<'explain' | 'requested' | 'confirm' | 'done'>('explain');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function requestDeletion() {
    setError(null);
    await api('POST', '/account/deletion-request', { email });
    setStage('requested');
  }

  async function confirmDeletion() {
    setError(null);
    try {
      await api('POST', '/account/deletion-confirm', { email, token });
      setStage('done');
    } catch {
      setError('That confirmation token is not valid.');
    }
  }

  return (
    <main className="column">
      <h1>Forgotten master password</h1>

      <section
        style={{ border: '1px solid var(--danger)', borderRadius: 6, padding: '0.85rem 1rem', margin: '1rem 0' }}
      >
        <p style={{ margin: 0 }}>
          <strong>Your vault cannot be recovered.</strong> Its contents are encrypted with a key
          derived from your master password, on your own device. We never received that password
          and we hold nothing that can decrypt your data — not a copy, not an escrow key, not a
          backdoor. This is the property that keeps your secrets private from us, and it is the
          same property that makes them unrecoverable now.
        </p>
      </section>

      <p>
        No one can reset it for you. The only action available is to delete the account and start
        again with a new vault, which <strong>permanently destroys every secret it holds</strong>.
      </p>

      {stage === 'explain' && (
        <>
          <label style={{ display: 'block', margin: '1rem 0' }}>
            Email address of the account
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </label>
          <button
            type="button"
            onClick={requestDeletion}
            disabled={!email.includes('@')}
            style={dangerButton(email.includes('@'))}
          >
            Delete this account permanently
          </button>
        </>
      )}

      {stage === 'requested' && (
        <>
          <p>
            If that address has an account, a confirmation token has been emailed to it. We ask
            you to confirm by email because you cannot prove knowledge of a password you have
            forgotten — but you can prove you control the mailbox.
          </p>
          <label style={{ display: 'block', margin: '1rem 0' }}>
            Confirmation token
            <input value={token} onChange={(e) => setToken(e.target.value)} style={inputStyle} />
          </label>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button type="button" onClick={confirmDeletion} disabled={!token} style={dangerButton(!!token)}>
            Confirm permanent deletion
          </button>
        </>
      )}

      {stage === 'done' && <p>The account and everything in it has been deleted.</p>}

      <p style={{ marginTop: '1.5rem' }}>
        <button type="button" onClick={onBack} style={linkStyle}>
          Back to unlock
        </button>
      </p>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.55rem 0.7rem',
  marginTop: '0.3rem',
  fontSize: '1rem',
  border: '1px solid var(--border)',
  borderRadius: 5,
  background: 'var(--bg)',
  color: 'var(--fg)',
};

const dangerButton = (enabled: boolean): React.CSSProperties => ({
  padding: '0.6rem 1.1rem',
  fontSize: '1rem',
  borderRadius: 5,
  border: '1px solid var(--danger)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  background: 'transparent',
  color: 'var(--danger)',
});

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--accent)',
  textDecoration: 'underline',
  cursor: 'pointer',
  font: 'inherit',
};
