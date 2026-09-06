/**
 * Copy to clipboard, cleared after a bounded interval (T064, FR-052).
 *
 * The user is told the clipboard will clear, and when. Clearing silently would leave someone
 * confused when a later paste comes up empty; not clearing at all leaves a password in the
 * system clipboard where any other application can read it.
 */
import { useEffect, useRef, useState } from 'react';

export const CLEAR_AFTER_MS = 30_000;

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'cleared' | 'failed'>('idle');
  const [remaining, setRemaining] = useState(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      if (tick.current) clearInterval(tick.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be refused (no user gesture, insecure context, permissions).
      // Say so rather than claiming a copy that did not happen.
      setState('failed');
      return;
    }
    setState('copied');
    setRemaining(CLEAR_AFTER_MS / 1000);

    if (tick.current) clearInterval(tick.current);
    tick.current = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);

    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      // Only clear if the clipboard still holds OUR value — overwriting whatever the user
      // copied in the meantime would be worse than leaving the password there.
      void navigator.clipboard
        .readText()
        .then((current) => (current === value ? navigator.clipboard.writeText('') : undefined))
        .catch(() => navigator.clipboard.writeText('').catch(() => {}))
        .finally(() => {
          if (tick.current) clearInterval(tick.current);
          setState('cleared');
        });
    }, CLEAR_AFTER_MS);
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <button type="button" onClick={() => void copy()} style={miniButton} aria-label={`Copy ${label}`}>
        Copy
      </button>
      {state === 'copied' && (
        <small style={{ color: 'var(--muted)' }}>copied — clipboard clears in {remaining}s</small>
      )}
      {state === 'cleared' && <small style={{ color: 'var(--muted)' }}>clipboard cleared</small>}
      {state === 'failed' && (
        <small style={{ color: 'var(--danger)' }}>the browser refused clipboard access</small>
      )}
    </span>
  );
}

const miniButton: React.CSSProperties = {
  padding: '0.2rem 0.5rem',
  fontSize: '0.8rem',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};
