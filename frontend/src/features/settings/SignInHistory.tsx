/**
 * Sign-in history (T115, research.md §9).
 *
 * This exists because there is no password recovery: an intruder who quietly changes the master
 * password locks the owner out permanently, so the owner needs to be able to SEE that something
 * happened. Failed attempts are shown as well as successful ones — a run of failures against
 * your account is worth knowing about.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

interface SignInEvent {
  id: string;
  outcome: 'success' | 'bad_password' | 'bad_totp' | 'rate_limited';
  at: string;
  coarseLocation: string | null;
  deviceLabel: string | null;
}

const DESCRIPTION: Record<SignInEvent['outcome'], string> = {
  success: 'Signed in',
  bad_password: 'Wrong master password',
  bad_totp: 'Wrong two-factor code',
  rate_limited: 'Too many attempts — blocked',
};

export function SignInHistory() {
  const [events, setEvents] = useState<SignInEvent[] | null>(null);

  useEffect(() => {
    void api<SignInEvent[]>('GET', '/security/sign-ins')
      .then(setEvents)
      .catch(() => setEvents([]));
  }, []);

  if (!events) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;

  const failures = events.filter((e) => e.outcome !== 'success').length;

  return (
    <section>
      <h3>Recent sign-ins</h3>
      <p style={{ color: 'var(--muted)', fontSize: '0.92rem' }}>
        Kept for 90 days. Locations are deliberately rough — enough to notice something
        unfamiliar, not a record of where you have been.
      </p>

      {failures > 0 && (
        <p style={{ color: 'var(--warn)', fontSize: '0.92rem' }}>
          {failures} failed attempt{failures === 1 ? '' : 's'} in this period. If they were not
          you, change your master password.
        </p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {events.map((event) => (
          <li
            key={event.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: '0.75rem',
              padding: '0.4rem 0',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.92rem',
            }}
          >
            <span style={{ color: event.outcome === 'success' ? 'var(--fg)' : 'var(--danger)' }}>
              {DESCRIPTION[event.outcome]}
              {event.coarseLocation && (
                <span style={{ color: 'var(--muted)' }}> · around {event.coarseLocation}</span>
              )}
            </span>
            <span style={{ color: 'var(--muted)' }}>{new Date(event.at).toLocaleString()}</span>
          </li>
        ))}
        {events.length === 0 && <li style={{ color: 'var(--muted)' }}>Nothing recorded yet.</li>}
      </ul>
    </section>
  );
}
