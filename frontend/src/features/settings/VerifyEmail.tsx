/**
 * Email verification: the landing page for the emailed link, and the in-app reminder (T144).
 *
 * Verification gates being shared WITH, nothing else. So this never blocks the vault — an
 * unverified user can store and read their own secrets from the moment they register. The
 * banner says what is actually unavailable rather than nagging, because a reminder that does
 * not explain what it is for is just noise.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';

/**
 * Handles `/verify?token=…`.
 *
 * Rendered before the unlock screen and without a session: the link is opened in whatever
 * browser the mail client hands it to, which is rarely the one holding the session.
 */
export function VerifyLanding({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void api('POST', '/auth/verify', { token })
      .then(() => setState('done'))
      .catch((err: unknown) => {
        setState('failed');
        setMessage(
          err instanceof Error
            ? err.message
            : 'That link is not valid. Sign in and ask for a new one.',
        );
      });
  }, [token]);

  return (
    <main className="column">
      <h1>{state === 'done' ? 'Address confirmed' : 'Confirming your address'}</h1>

      {state === 'working' && <p style={{ color: 'var(--muted)' }}>One moment…</p>}

      {state === 'done' && (
        <p>
          Thank you — other people can now share vaults with this address. Nothing about your own
          vault has changed.
        </p>
      )}

      {state === 'failed' && <p style={{ color: 'var(--danger)' }}>{message}</p>}

      <button type="button" onClick={onDone} style={primary}>
        Continue to your vault
      </button>
    </main>
  );
}

/** The in-app reminder. Absent entirely once the address is confirmed. */
export function VerifyBanner() {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    const status = await api<{ verified: boolean }>('GET', '/auth/verify/status');
    setVerified(status.verified);
  }, []);

  // A failure here is treated as verified: a banner that appears because the status call fell
  // over would tell the user to fix something that is not broken.
  useEffect(() => void load().catch(() => setVerified(true)), [load]);

  if (verified !== false) return null;

  return (
    <p
      role="status"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '0.55rem 0.8rem',
        margin: '0 0 1rem',
        fontSize: '0.9rem',
      }}
    >
      <strong>Confirm your email address</strong> to let other people share vaults with you. Your
      own vault works normally in the meantime — nothing here is waiting on it.{' '}
      {sent ? (
        <span style={{ color: 'var(--muted)' }}>Sent — check your inbox.</span>
      ) : (
        <button
          type="button"
          onClick={() => {
            // The same acknowledgement either way: whether a resend happened is not information
            // this button should reveal.
            void api('POST', '/auth/verify/resend')
              .then(() => setSent(true))
              .catch(() => setSent(true));
          }}
          style={link}
        >
          Send the link again
        </button>
      )}
    </p>
  );
}

const primary: React.CSSProperties = {
  padding: '0.6rem 1.1rem',
  marginTop: '1rem',
  border: 'none',
  borderRadius: 5,
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
};

const link: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--accent)',
  cursor: 'pointer',
  font: 'inherit',
};
