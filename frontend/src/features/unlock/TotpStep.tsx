/**
 * The second-factor step at sign-in (T114).
 *
 * The seed is sealed under the UserKey, so the code is checked HERE. The server only learns
 * which time step was accepted — enough for it to refuse that step being spent twice, and not
 * enough for it to compute a code itself.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client.js';
import { decrypt } from '../../crypto/envelope.js';
import { verifyCode } from '../../crypto/totp.js';

export function TotpStep({
  userKey,
  onVerified,
  onCancel,
}: {
  userKey: Uint8Array;
  onVerified: () => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (useBackup) {
        // A backup code is the one thing the server CAN check itself: it holds the digest.
        await api('POST', '/auth/totp/verify', { backupCode: code.trim() });
      } else {
        const challenge = await api<{ wrappedSecret: string; lastUsedStep: number | null }>(
          'GET',
          '/auth/totp/challenge',
        );
        const secret = await decrypt(userKey, challenge.wrappedSecret as never);
        const result = await verifyCode(secret, code, {
          lastUsedStep: challenge.lastUsedStep ?? undefined,
        });
        if (!result.ok) {
          setError(
            challenge.lastUsedStep !== null && result.step <= challenge.lastUsedStep
              ? 'That code has already been used. Wait for the app to show the next one.'
              : 'That code is not right. Check the app and try the current code.',
          );
          return;
        }
        await api('POST', '/auth/totp/verify', { step: result.step });
      }

      setCode('');
      await onVerified();
    } catch {
      setError(useBackup ? 'That backup code is not valid, or has been used.' : 'That code was refused.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Two-factor code</h1>
      <p style={{ color: 'var(--muted)' }}>
        {useBackup
          ? 'Enter one of the backup codes you saved when you turned this on. Each works once.'
          : 'Enter the current code from your authenticator app.'}
      </p>

      <form onSubmit={submit}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          placeholder={useBackup ? 'abcd-efgh' : '000000'}
          style={{
            display: 'block',
            width: '100%',
            maxWidth: '14rem',
            padding: '0.55rem 0.7rem',
            fontSize: '1.15rem',
            fontFamily: 'ui-monospace, Menlo, monospace',
            letterSpacing: '0.08em',
            border: '1px solid var(--border)',
            borderRadius: 5,
            background: 'var(--bg)',
            color: 'var(--fg)',
          }}
        />

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        <button
          type="submit"
          disabled={busy || code.trim().length < 6}
          style={{
            marginTop: '1rem',
            padding: '0.6rem 1.1rem',
            border: 'none',
            borderRadius: 5,
            background: 'var(--accent)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>

      <p style={{ marginTop: '1.25rem', fontSize: '0.92rem' }}>
        <button type="button" onClick={() => { setUseBackup((b) => !b); setCode(''); setError(null); }} style={link}>
          {useBackup ? 'Use the authenticator app instead' : 'Use a backup code instead'}
        </button>
        {' · '}
        <button type="button" onClick={onCancel} style={link}>
          Cancel
        </button>
      </p>
    </main>
  );
}

const link: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--accent)',
  textDecoration: 'underline',
  cursor: 'pointer',
  font: 'inherit',
};
