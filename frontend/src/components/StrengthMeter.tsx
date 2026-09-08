/**
 * Live master password strength (T033, FR-002).
 *
 * Shows the score as it is typed and names what is wrong. The estimator's dictionaries are
 * ~400KB and load lazily, so nothing is downloaded until this component first renders.
 */
import { useEffect, useState } from 'react';
import { MIN_LENGTH, assessMasterPassword, type StrengthResult } from '../crypto/password-strength.js';

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

/*
 * The segments are all one colour now (T056). The design system has no red, and shading the fill
 * by score would have left weakness signalled by hue alone — which FR-021a forbids and which a
 * colour-blind reader would miss entirely. How many segments are filled, and the label naming the
 * band in words, carry the meaning instead. The bands, labels, problems, suggestions and the
 * submit gating on `acceptable` are all unchanged.
 */
const FILLED = 'var(--color-accent)';
const EMPTY = 'var(--color-neutral-300)';

export function StrengthMeter({
  password,
  onAssessed,
}: {
  password: string;
  onAssessed?: (result: StrengthResult | null) => void;
}) {
  const [result, setResult] = useState<StrengthResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (password.length === 0) {
      setResult(null);
      onAssessed?.(null);
      return;
    }
    // Debounced: assessment is not free, and running it on every keystroke makes typing janky.
    const handle = setTimeout(() => {
      void assessMasterPassword(password).then((r) => {
        if (cancelled) return;
        setResult(r);
        onAssessed?.(r);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [password, onAssessed]);

  if (password.length === 0) {
    return (
      <p style={guidance}>
        At least {MIN_LENGTH} characters. A passphrase of several unrelated words is both
        stronger and easier to remember than a short, complicated one.
      </p>
    );
  }

  if (!result) return <p style={guidance}>Checking…</p>;

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div
        role="progressbar"
        aria-valuenow={result.score}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-label="Master password strength"
        style={{ display: 'flex', gap: 4 }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 999,
              background: i <= result.score ? FILLED : EMPTY,
            }}
          />
        ))}
      </div>
      <p style={label}>
        {LABELS[result.score]}
        {result.acceptable ? ' — acceptable' : ''}
      </p>
      {result.problems.map((problem) => (
        <p key={problem} style={{ ...guidance, color: 'var(--color-accent-700)' }}>
          {problem}
        </p>
      ))}
      {!result.acceptable &&
        result.suggestions.slice(0, 2).map((s) => (
          <p key={s} style={guidance}>
            {s}
          </p>
        ))}
    </div>
  );
}

const label: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-accent-700)',
};

const guidance: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 12.5,
  color: 'var(--color-neutral-700)',
};
