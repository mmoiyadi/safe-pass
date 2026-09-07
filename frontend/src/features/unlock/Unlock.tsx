/**
 * Unlock (T053).
 *
 * Argon2id at 64 MiB takes a noticeable moment on a phone, so the wait is shown and explained
 * — an unexplained pause on a password field reads as a hang, and the cost is deliberate.
 */
import { useState, type FormEvent } from 'react';
import { signIn } from '../../vault/session.js';
import { unlockOffline } from '../../vault/offline-session.js';
import { ApiError } from '../../api/client.js';

export function Unlock({
  onUnlocked,
  onTotpRequired,
  onForgot,
  onRegister,
}: {
  onUnlocked: (email: string, offline?: boolean) => void;
  /** The password is handed on because the unlock is not finished until the factor clears. */
  onTotpRequired: (email: string, password: string, userKey: Uint8Array) => void;
  onForgot: () => void;
  onRegister: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await signIn(email, password);
      if (result.totpRequired && result.userKey) {
        onTotpRequired(email, password, result.userKey);
        setPassword('');
        return;
      }
      setPassword('');
      onUnlocked(email);
    } catch (err) {
      // A server that cannot be reached is not a rejected password. Fall back to the encrypted
      // copy on this device, if there is one (FR-054). The password still has to unwrap the
      // cached keys, so this is not a weaker check — it is the same check, run locally.
      const unreachable =
        err instanceof ApiError && (err.code === 'NETWORK_UNREACHABLE' || err.code === 'OFFLINE');

      if (unreachable) {
        try {
          const offline = await unlockOffline(email, password);
          if (offline) {
            setPassword('');
            onUnlocked(email, true);
            return;
          }
          setError(
            'This device is offline and has no stored copy of that vault. Reconnect to sign in ' +
              'for the first time on this device.',
          );
        } catch {
          // Reached the cache but could not open it: the password is wrong, or the copy belongs
          // to a password that has since been changed elsewhere.
          setError(
            'That master password does not open the copy stored on this device. If you changed ' +
              'it on another device, reconnect so this one can catch up.',
          );
        }
        return;
      }

      // Deliberately does not distinguish an unknown account from a wrong password (FR-003).
      setError('That email address and master password do not match an account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Unlock your vault</h1>
      <form onSubmit={submit}>
        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
          Email address
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          Master password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={inputStyle}
          />
        </label>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        <button type="submit" disabled={busy} style={buttonStyle(!busy)}>
          {busy ? 'Deriving your key…' : 'Unlock'}
        </button>
        {busy && (
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            This takes a moment on purpose. Deriving the key is deliberately slow, which is what
            makes guessing your master password expensive for an attacker.
          </p>
        )}
      </form>

      <p style={{ marginTop: '1.5rem', fontSize: '0.92rem' }}>
        <button type="button" onClick={onForgot} style={linkStyle}>
          I have forgotten my master password
        </button>
        {' · '}
        <button type="button" onClick={onRegister} style={linkStyle}>
          Create a new vault
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

const buttonStyle = (enabled: boolean): React.CSSProperties => ({
  padding: '0.6rem 1.1rem',
  fontSize: '1rem',
  borderRadius: 5,
  border: 'none',
  cursor: enabled ? 'pointer' : 'wait',
  background: 'var(--accent)',
  color: '#fff',
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
