/**
 * The per-device offline switch (FR-059, FR-058).
 *
 * Offline reading is useful and it is also, honestly, extra exposure: this device holds a copy
 * of the vault it would not otherwise have. The copy is ciphertext and useless without the
 * master password, but a user on a shared or short-lived machine is entitled to decide they do
 * not want it there at all — and to have that take effect immediately, not at next sign-in.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  MAX_CACHE_AGE_MS,
  cacheAge,
  isOfflineEnabled,
  setOfflineEnabled,
} from '../../vault/offline-cache.js';
import { purgeServiceWorkerCaches } from '../../sw/register.js';

const DAYS = MAX_CACHE_AGE_MS / (24 * 60 * 60 * 1000);

function describeAge(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function OfflineAccess({ email }: { email: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [age, setAge] = useState<number | null>(null);

  const load = useCallback(async () => {
    setEnabled(await isOfflineEnabled());
    setAge(await cacheAge(email));
  }, [email]);

  useEffect(() => void load().catch(() => {}), [load]);

  async function toggle(next: boolean) {
    await setOfflineEnabled(next);
    // Turning it off means the copy goes now, including the cached application shell.
    if (!next) purgeServiceWorkerCaches();
    await load();
  }

  if (enabled === null) return null;

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>Offline access</h2>

      <p style={note}>
        With this on, a vault you have opened here at least once stays readable with no network.
        The copy on this device is <strong>encrypted</strong> — it holds nothing your master
        password does not open, and your keys are never written to disk.
      </p>
      <p style={note}>
        Reading only: creating, editing, deleting, and sharing all need a connection, and nothing
        is queued while offline. The copy is discarded after {DAYS} days, when you sign out, and
        when your access to a vault is withdrawn.
      </p>

      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.6rem 0' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => void toggle(e.target.checked)} />
        Keep an encrypted copy on this device
      </label>

      <p style={note}>
        {enabled
          ? age === null
            ? 'Nothing is stored on this device yet — a copy is made the next time your vault loads.'
            : `Last refreshed ${describeAge(age)}.`
          : 'No copy is held on this device. Your vault needs a connection to open here.'}
      </p>
    </section>
  );
}

const note: React.CSSProperties = { color: 'var(--muted)', fontSize: '0.92rem', margin: '0 0 0.6rem' };
