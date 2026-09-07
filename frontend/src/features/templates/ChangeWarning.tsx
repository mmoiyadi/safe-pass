/**
 * The warning before a template change that would orphan stored values (T119, FR-042).
 *
 * Removing a field from a template does not delete anything: the values stay in the JSONB
 * exactly where they were. But nothing renders them any more, and a value you cannot see or
 * copy is, from where the user is sitting, a value you have lost. That distinction is real but
 * useless to explain *afterwards*, so this asks first — and names the fields and the count,
 * because "this may affect existing data" is a warning nobody can act on.
 *
 * Deliberately not a `window.confirm`: that cannot list the fields, and it blocks the page.
 */
import type { TemplateField } from '@pm/shared';

export interface Impact {
  /** Field ids no longer present in the proposed version. */
  removedFields: string[];
  /** How many stored secrets actually hold a value in one of them. */
  affectedSecrets: number;
}

/**
 * Resolves field ids to the labels the user actually typed. The ids are slugs and some belong
 * to versions that no longer exist, so anything unresolvable falls back to the id itself
 * rather than being dropped — a field we cannot name is still a field being removed.
 */
function labelsFor(ids: string[], known: TemplateField[]): string[] {
  return ids.map((id) => known.find((f) => f.id === id)?.label ?? id);
}

export function ChangeWarning({
  impact,
  knownFields,
  onConfirm,
  onCancel,
  busy = false,
}: {
  impact: Impact;
  /** Fields of the version being edited, used to show labels instead of slugs. */
  knownFields: TemplateField[];
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { removedFields, affectedSecrets } = impact;
  // Nothing at stake, nothing to confirm. The caller shows a plain note for that case.
  if (removedFields.length === 0 || affectedSecrets === 0) return null;

  const names = labelsFor(removedFields, knownFields);
  const plural = removedFields.length === 1 ? '' : 's';

  return (
    <div style={panel} role="alertdialog" aria-labelledby="change-warning-title">
      <h3 id="change-warning-title" style={title}>
        This will hide values you have already saved
      </h3>

      <p style={body}>
        You are removing {removedFields.length} field{plural}:
      </p>
      <ul style={fieldList}>
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>

      <p style={body}>
        <strong>
          {affectedSecrets} secret{affectedSecrets === 1 ? '' : 's'}
        </strong>{' '}
        currently {affectedSecrets === 1 ? 'holds' : 'hold'} a value in{' '}
        {removedFields.length === 1 ? 'that field' : 'those fields'}.
      </p>

      <p style={{ ...body, color: 'var(--muted)' }}>
        The values are not deleted — they stay encrypted in place — but nothing will display them
        or copy them, so treat this as losing them. If you need them, copy them out of those
        secrets before you save.
      </p>

      <p style={{ ...body, color: 'var(--muted)' }}>
        Secrets written under the current version keep rendering as they are. This changes what
        you see from the new version onwards.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={onCancel} style={ghost} autoFocus>
          Go back and keep {removedFields.length === 1 ? 'the field' : 'them'}
        </button>
        <button type="button" onClick={onConfirm} disabled={busy} style={danger}>
          {busy ? 'Saving…' : `Remove ${removedFields.length} field${plural} anyway`}
        </button>
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  border: '1px solid var(--danger)',
  borderRadius: 6,
  padding: '0.9rem 1rem',
  margin: '1rem 0',
};

const title: React.CSSProperties = { margin: '0 0 0.5rem', fontSize: '1rem', color: 'var(--danger)' };
const body: React.CSSProperties = { margin: '0 0 0.5rem', fontSize: '0.92rem' };

const fieldList: React.CSSProperties = {
  margin: '0 0 0.6rem',
  paddingLeft: '1.2rem',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const ghost: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
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
