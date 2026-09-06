/**
 * Registration (T049, FR-002, FR-010).
 *
 * The no-recovery warning is not fine print. It is the single most consequential fact about
 * this product, it must be acknowledged explicitly before the account can exist, and the
 * acknowledgement is enforced by the server as well as here.
 */
import { useState, type FormEvent } from 'react';
import { StrengthMeter } from '../../components/StrengthMeter.js';
import type { StrengthResult } from '../../crypto/password-strength.js';
import { register } from '../../vault/session.js';

export function Register({ onRegistered }: { onRegistered: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [strength, setStrength] = useState<StrengthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    email.includes('@') && (strength?.acceptable ?? false) && !mismatch && confirm.length > 0 && acknowledged;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(email, password);
      onRegistered(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Create your vault</h1>

      <section
        style={{
          border: '1px solid var(--danger)',
          borderRadius: 6,
          padding: '0.85rem 1rem',
          margin: '1rem 0',
        }}
      >
        <h2 style={{ margin: '0 0 0.4rem', fontSize: '1rem', color: 'var(--danger)' }}>
          There is no way to recover a forgotten master password
        </h2>
        <p style={{ margin: 0, fontSize: '0.92rem' }}>
          Your secrets are encrypted on this device with a key derived from your master password.
          We never receive that password and hold nothing that can decrypt your vault. If you
          forget it, <strong>your vault is permanently and irreversibly lost</strong> — no reset
          link, no support request, no exception. The only remaining action would be to delete
          the account and start over.
        </p>
      </section>

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

        <label style={{ display: 'block', marginBottom: '0.35rem' }}>
          Master password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            style={inputStyle}
          />
        </label>
        <StrengthMeter password={password} onAssessed={setStrength} />

        <label style={{ display: 'block', margin: '0.85rem 0' }}>
          Confirm master password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            style={inputStyle}
          />
          {mismatch && (
            <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
              The two passwords do not match.
            </span>
          )}
        </label>

        <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', margin: '1rem 0' }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span style={{ fontSize: '0.92rem' }}>
            I understand that if I forget my master password, my vault cannot be recovered by
            anyone, including the people who run this service.
          </span>
        </label>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        <button type="submit" disabled={!canSubmit || busy} style={buttonStyle(canSubmit && !busy)}>
          {busy ? 'Creating your vault…' : 'Create vault'}
        </button>
      </form>
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
  cursor: enabled ? 'pointer' : 'not-allowed',
  background: enabled ? 'var(--accent)' : 'var(--border)',
  color: enabled ? '#fff' : 'var(--muted)',
});
