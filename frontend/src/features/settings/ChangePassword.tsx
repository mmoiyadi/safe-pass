/**
 * Master password change (T056, FR-005, FR-075).
 *
 * Two things must be said before the user commits: their other devices will need the new
 * password, and a device that is offline keeps reading its cached copy until it reconnects.
 * The second is easy to omit and would leave the user with a false belief about who still has
 * access.
 */
import { useState, type FormEvent } from 'react';
import { StrengthMeter } from '../../components/StrengthMeter.js';
import type { StrengthResult } from '../../crypto/password-strength.js';
import { changeMasterPassword } from '../../vault/session.js';

export function ChangePassword({
  email,
  wrappedUserKey,
  onChanged,
}: {
  email: string;
  wrappedUserKey: string;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [strength, setStrength] = useState<StrengthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await changeMasterPassword(email, current, next, wrappedUserKey);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the master password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Change master password</h2>

      <p style={{ fontSize: '0.92rem', color: 'var(--muted)' }}>
        Only your key is re-wrapped — none of your secrets are re-encrypted, so this is fast
        however large your vault is. Any backup you exported earlier still opens only with the
        password that was in force when you took it.
      </p>
      <p style={{ fontSize: '0.92rem' }}>
        <strong>Your other signed-in devices will ask for the new password</strong> the next time
        they do anything. A device that is offline right now keeps access to its cached copy
        until it reconnects.
      </p>

      <form onSubmit={submit}>
        <label style={{ display: 'block', marginBottom: '0.85rem' }}>
          Current master password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required style={input} />
        </label>
        <label style={{ display: 'block' }}>
          New master password
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required style={input} />
        </label>
        <StrengthMeter password={next} onAssessed={setStrength} />

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button
          type="submit"
          disabled={busy || !current || !(strength?.acceptable ?? false)}
          style={{
            marginTop: '1rem',
            padding: '0.6rem 1.1rem',
            fontSize: '1rem',
            borderRadius: 5,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {busy ? 'Changing…' : 'Change master password'}
        </button>
      </form>
    </section>
  );
}

const input: React.CSSProperties = {
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
