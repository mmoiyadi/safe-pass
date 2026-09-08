/**
 * Copy to clipboard, cleared after a bounded interval (T064, FR-052).
 *
 * The user is told the clipboard will clear, and when. Clearing silently would leave someone
 * confused when a later paste comes up empty; not clearing at all leaves a password in the
 * system clipboard where any other application can read it.
 */
import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Icon } from './Icon.js';

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
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => void copy()}
        className="icon-button"
        aria-label={`Copy ${label}`}
      >
        <Icon icon={Copy} size={15} />
      </button>
      {/*
        The acknowledgement moves out of the row it used to sit inside, so a row's width no
        longer jumps when a countdown appears. Every one of the three states keeps its exact
        wording: the countdown, the confirmation, and the refusal (FR-004).
      */}
      {state === 'copied' && (
        <small style={acknowledgement}>copied — clipboard clears in {remaining}s</small>
      )}
      {state === 'cleared' && <small style={acknowledgement}>clipboard cleared</small>}
      {state === 'failed' && (
        <small style={{ ...acknowledgement, color: 'var(--color-accent-700)' }}>
          the browser refused clipboard access
        </small>
      )}
    </span>
  );
}

/**
 * Out of flow, as a small toast under the button.
 *
 * Inline, it stole width from whatever sat beside it — in a 352px list row that collapsed the
 * title and summary to ellipses the moment anything was copied. The handoff asks for "a 12px
 * line under the row or a toast rather than inline text" for exactly this reason. Taking it out
 * of the flow also means no layout shifts when it appears and disappears (FR-024).
 */
const acknowledgement: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  zIndex: 1,
  marginTop: 2,
  padding: '3px 9px',
  borderRadius: 999,
  background: 'var(--color-neutral-200)',
  boxShadow: 'var(--shadow-sm)',
  fontSize: 12,
  color: 'var(--color-neutral-700)',
  whiteSpace: 'nowrap',
};
