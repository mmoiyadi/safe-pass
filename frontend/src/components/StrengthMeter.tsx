/**
 * Live master password strength (T033, FR-002).
 *
 * Shows the score as it is typed and names what is wrong. The estimator's dictionaries are
 * ~400KB and load lazily, so nothing is downloaded until this component first renders.
 */
import { useEffect, useState } from 'react';
import { MIN_LENGTH, assessMasterPassword, type StrengthResult } from '../crypto/password-strength.js';

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
const COLORS = ['var(--danger)', 'var(--danger)', 'var(--warn)', 'var(--accent)', 'var(--accent)'];

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
      <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0.4rem 0 0' }}>
        At least {MIN_LENGTH} characters. A passphrase of several unrelated words is both
        stronger and easier to remember than a short, complicated one.
      </p>
    );
  }

  if (!result) return <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Checking…</p>;

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div
        role="progressbar"
        aria-valuenow={result.score}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-label="Master password strength"
        style={{ display: 'flex', gap: 3 }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= result.score ? COLORS[result.score] : 'var(--border)',
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: '0.85rem', margin: '0.4rem 0 0', color: COLORS[result.score] }}>
        {LABELS[result.score]}
        {result.acceptable ? ' — acceptable' : ''}
      </p>
      {result.problems.map((problem) => (
        <p key={problem} style={{ fontSize: '0.85rem', margin: '0.2rem 0 0', color: 'var(--danger)' }}>
          {problem}
        </p>
      ))}
      {!result.acceptable &&
        result.suggestions.slice(0, 2).map((s) => (
          <p key={s} style={{ fontSize: '0.85rem', margin: '0.2rem 0 0', color: 'var(--muted)' }}>
            {s}
          </p>
        ))}
    </div>
  );
}
