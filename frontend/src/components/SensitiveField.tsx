/**
 * Masked value with reveal-on-demand (T063, FR-041).
 *
 * Masking is driven by the template field's `sensitive` flag — a property of the DATA, not of
 * this component's caller. That is what lets a user-defined template decide what is secret
 * without any code change (Principle V).
 *
 * The value re-masks automatically. A revealed password left on screen is the most common way
 * a vault leaks in an office, and it is not the user's job to remember to hide it again.
 */
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Icon } from './Icon.js';

const AUTO_HIDE_MS = 30_000;

export function SensitiveField({
  value,
  label,
  multiline = false,
}: {
  value: string;
  label: string;
  multiline?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!revealed) return;
    timer.current = setTimeout(() => setRevealed(false), AUTO_HIDE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [revealed]);

  // Fixed-width mask: the real length is itself information worth withholding.
  const masked = '•'.repeat(12);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <code
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          padding: '0.2rem 0.45rem',
          borderRadius: 4,
          background: 'var(--border)',
          whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
          maxWidth: '100%',
          overflowWrap: 'anywhere',
        }}
      >
        {revealed ? value : masked}
      </code>
      {/*
        A round icon button rather than a text one — shape only. The accessible name is
        unchanged and still carries the field label, which is the whole of what a screen
        reader had before (FR-025).
      */}
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
        className="icon-button"
      >
        <Icon icon={revealed ? EyeOff : Eye} size={15} />
      </button>
    </span>
  );
}
