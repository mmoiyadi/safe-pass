/**
 * Delete confirmation (T065, FR-053, FR-077, FR-078).
 *
 * Deletion is immediate and irreversible — that was decided in the 2026-09-01 clarification, so
 * this dialog has to carry the full weight of it. It names the secret, states plainly that it
 * cannot be undone, says a prior backup is the only recovery, and warns that in a shared vault
 * it disappears for everyone at once.
 *
 * The confirm button requires typing the title. A one-click "Delete" on an irreversible action
 * with no trash behind it is a misclick away from permanent loss.
 */
import { useEffect, useRef, useState } from 'react';

export function DeleteDialog({
  title,
  shared,
  onConfirm,
  onCancel,
}: {
  title: string;
  shared: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const matches = typed.trim() === title.trim();

  return (
    <div role="dialog" aria-modal="true" aria-label={`Delete ${title}`} style={backdrop}>
      <div style={panel}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem', color: 'var(--danger)' }}>
          Permanently delete “{title}”?
        </h2>

        <p style={{ fontSize: '0.92rem' }}>
          <strong>This cannot be undone.</strong> There is no trash and no restore — the secret
          and its ciphertext are removed immediately.
        </p>
        <p style={{ fontSize: '0.92rem' }}>
          The only way to get it back is a backup you exported <em>before</em> now.
        </p>
        {shared && (
          <p style={{ fontSize: '0.92rem', color: 'var(--danger)' }}>
            This vault is shared. Deleting removes it for <strong>every member</strong>, straight
            away — not just for you.
          </p>
        )}

        <label style={{ display: 'block', margin: '1rem 0 0.5rem', fontSize: '0.9rem' }}>
          Type <code>{title}</code> to confirm
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{
              display: 'block',
              width: '100%',
              padding: '0.5rem 0.65rem',
              marginTop: '0.3rem',
              fontSize: '1rem',
              border: '1px solid var(--border)',
              borderRadius: 5,
              background: 'var(--bg)',
              color: 'var(--fg)',
            }}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button
            type="button"
            disabled={!matches || busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
            style={{
              padding: '0.5rem 0.9rem',
              borderRadius: 5,
              border: '1px solid var(--danger)',
              background: matches ? 'var(--danger)' : 'transparent',
              color: matches ? '#fff' : 'var(--muted)',
              cursor: matches && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
          <button type="button" onClick={onCancel} style={{
            padding: '0.5rem 0.9rem',
            borderRadius: 5,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--fg)',
            cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * The dialog vocabulary (T079/T080). Backdrop and panel only — every word of
 * copy, the typed-title confirmation, and the folder dialog's refusal to
 * pre-select a disposition are all untouched (FR-012).
 */
const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'color-mix(in srgb, var(--color-neutral-900) 34%, transparent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  zIndex: 50,
};

const panel: React.CSSProperties = {
  boxShadow: 'var(--shadow-lg)',
  background: 'var(--color-bg)',
  border: '1px solid var(--border)',
  borderRadius: 28,
  padding: '28px 30px',
  maxWidth: '30rem',
  width: '100%',
};
