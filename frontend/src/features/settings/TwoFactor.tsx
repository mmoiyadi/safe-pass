/**
 * Second factor: enrolment, backup codes, removal (T108, T113).
 *
 * The seed is generated here and sealed under the UserKey before it goes anywhere, so the
 * server stores a wrap it cannot open. Enrolment is only accepted after the user proves the
 * authenticator app is actually working — otherwise it is possible to lock yourself out of an
 * account that has no recovery, which is the worst outcome this product can produce.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Envelope, TotpSeed } from '@pm/shared';
import { bytesToBase64Url } from '@pm/shared';
import { api } from '../../api/client.js';
import { encrypt } from '../../crypto/envelope.js';
import { buildOtpAuthUri, generateTotpSecret, verifyCode } from '../../crypto/totp.js';
import { deriveAuthHash, deriveMasterKey } from '../../crypto/kdf.js';
import { userKeyForTotp } from '../../vault/session.js';

interface Status {
  enrolled: boolean;
  backupCodesRemaining: number;
}

export function TwoFactor({ email }: { email: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [removing, setRemoving] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus(await api<Status>('GET', '/auth/totp'));
  }, []);

  useEffect(() => void load().catch(() => {}), [load]);

  function begin() {
    setError(null);
    setCodes(null);
    // Generated here and never sent unwrapped.
    setSecret(generateTotpSecret());
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!secret) return;
    setError(null);
    setBusy(true);
    try {
      // Verified locally first: enrolling on an app that is not actually working would lock
      // the account, and nothing could undo that.
      const result = await verifyCode(secret, code);
      if (!result.ok) {
        setError('That code does not match. Check the app and try the current code.');
        return;
      }

      const userKey = userKeyForTotp();
      if (!userKey) throw new Error('Sign in again to enrol.');

      const issued = await api<{ backupCodes: string[] }>('POST', '/auth/totp/enrol', {
        wrappedSecret: (await encrypt<TotpSeed>(userKey, secret)) as Envelope<TotpSeed>,
        confirmed: true,
      });

      setCodes(issued.backupCodes);
      setSecret(null);
      setCode('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enrol.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const masterKey = await deriveMasterKey(password, email);
      await api('DELETE', '/auth/totp', {
        authHash: bytesToBase64Url(await deriveAuthHash(masterKey, password)),
      });
      masterKey.fill(0);
      setPassword('');
      setRemoving(false);
      await load();
    } catch {
      setError('That master password is not correct.');
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;

  return (
    <section>
      <h3>Two-factor authentication</h3>

      {codes && (
        <div style={{ border: '1px solid var(--warn)', borderRadius: 6, padding: '0.85rem 1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.3rem', fontSize: '1rem' }}>Save these backup codes now</h3>
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.92rem' }}>
            They are shown <strong>once</strong> and each works a single time. Without your
            authenticator app <em>and</em> these codes there is no way back into this account —
            there is no password reset to fall back on.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))', gap: '0.3rem' }}>
            {codes.map((c) => (
              <li key={c} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{c}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(codes.join('\n')).catch(() => {})}
            style={{ ...ghost, marginTop: '0.6rem' }}
          >
            Copy all
          </button>
        </div>
      )}

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!status.enrolled && !secret && (
        <>
          <p style={note}>
            An authenticator app gives you a second factor for signing in. It raises the cost of
            a <strong>stolen password</strong> — it is not a defence against a device someone
            else already controls, because the code is checked on your own machine.
          </p>
          <button type="button" onClick={begin} style={primary}>
            Set up an authenticator app
          </button>
        </>
      )}

      {secret && (
        <form onSubmit={confirm}>
          <p style={note}>Add this to your authenticator app, then enter the code it shows.</p>
          <p style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '1.05rem', wordBreak: 'break-all' }}>
            {secret}
          </p>
          <p style={{ ...note, wordBreak: 'break-all' }}>
            <a href={buildOtpAuthUri({ secret, account: email })} style={{ color: 'var(--accent)' }}>
              Open in an authenticator app
            </a>
          </p>
          <label style={{ display: 'block', margin: '0.85rem 0' }}>
            Code from the app
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              style={input}
            />
          </label>
          <button type="submit" disabled={busy || code.replace(/\s/g, '').length < 6} style={primary}>
            {busy ? 'Confirming…' : 'Confirm and turn on'}
          </button>
          <button type="button" onClick={() => setSecret(null)} style={{ ...ghost, marginLeft: '0.5rem' }}>
            Cancel
          </button>
        </form>
      )}

      {status.enrolled && !secret && (
        <>
          <p style={{ fontSize: '0.95rem' }}>
            Two-factor authentication is <strong>on</strong>.{' '}
            <span style={{ color: status.backupCodesRemaining <= 2 ? 'var(--danger)' : 'var(--muted)' }}>
              {status.backupCodesRemaining} backup code
              {status.backupCodesRemaining === 1 ? '' : 's'} left.
            </span>
          </p>

          {!removing && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setRemoving(true)} style={danger}>
                Turn off
              </button>
            </div>
          )}

          {removing && (
            <form onSubmit={remove} style={{ marginTop: '0.6rem' }}>
              <p style={{ ...note, color: 'var(--danger)' }}>
                Turning this off leaves your vault protected by the master password alone, and
                invalidates your backup codes. We ask for your master password rather than
                accepting this session, because removing the second factor is exactly what
                someone with a stolen session would do first.
              </p>
              <label style={{ display: 'block', marginBottom: '0.6rem' }}>
                Master password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  style={input}
                />
              </label>
              <button type="submit" disabled={busy || !password} style={danger}>
                {busy ? 'Removing…' : 'Turn off two-factor authentication'}
              </button>
              <button type="button" onClick={() => { setRemoving(false); setPassword(''); }} style={{ ...ghost, marginLeft: '0.5rem' }}>
                Cancel
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

const note: React.CSSProperties = { color: 'var(--muted)', fontSize: '0.92rem', margin: '0 0 0.6rem' };

const input: React.CSSProperties = {
  display: 'block',
  width: '100%',
  maxWidth: '18rem',
  padding: '0.5rem 0.65rem',
  marginTop: '0.25rem',
  fontSize: '1rem',
  border: '1px solid var(--border)',
  borderRadius: 5,
  background: 'var(--bg)',
  color: 'var(--fg)',
};

const primary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: 5,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
};

const danger: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: 5,
  border: '1px solid var(--danger)',
  background: 'transparent',
  color: 'var(--danger)',
  cursor: 'pointer',
};

const ghost: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};
