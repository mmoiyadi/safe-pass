/**
 * Template-driven form renderer (T062).
 *
 * Renders a form from a TemplateVersion's `fields` array. Nothing here knows what a credit card
 * or a PAN card is — adding a fifth secret type is a database row, not a code change, which is
 * exactly what Constitution Principle V requires and what
 * `tests/integration/no-migration.test.ts` asserts.
 *
 * `sensitive` drives masking in the interface. It does NOT decide whether a value is encrypted:
 * every field value is encrypted regardless (data-model.md, "Why every value is encrypted").
 */
import { useId, useMemo, useState, type FormEvent } from 'react';
import type { FieldType, TemplateField, TemplateVersionRecord } from '@pm/shared';
import { CustomFields, type CustomField } from '../secret-detail/CustomFields.js';

export interface TemplateFormValues {
  title: string;
  fields: Record<string, string>;
  /** Extra fields belonging to this secret alone, not to its template (FR-039). */
  custom: CustomField[];
  /** Filing, applied at save time so a new secret does not land unfiled and get lost. */
  folderId: string | null;
  tagIds: string[];
}

export interface Filing {
  folders: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
}

/** Maps a template field type to an input type. Unknown types fall back to text rather than
 *  failing to render — a template is data and may name a type this build does not know. */
function inputTypeFor(type: FieldType): string {
  switch (type) {
    case 'password':
      return 'password';
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

export function TemplateForm({
  template,
  initial,
  filing,
  submitLabel = 'Save encrypted',
  onSubmit,
  onCancel,
}: {
  template: TemplateVersionRecord;
  initial?: TemplateFormValues;
  /** Folders and tags available in this vault. Omitted when the vault has none. */
  filing?: Filing;
  submitLabel?: string;
  onSubmit: (values: TemplateFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const ordered = useMemo(
    () => [...(template.fields as TemplateField[])].sort((a, b) => a.order - b.order),
    [template],
  );

  /**
   * Chrome largely ignores `autocomplete="off"` and falls back to heuristics on field name,
   * label, and position — which is how an email address ended up autofilled into a credit
   * card's "Expires" field during testing. Browser autofill writing into vault fields is bad
   * anywhere; in a password manager it silently corrupts the record being stored.
   *
   * The reliable defence is a name the heuristics cannot recognise, combined with
   * `autocomplete="new-password"`, which Chrome honours where "off" is ignored.
   */
  const formId = useId().replace(/:/g, '');
  const fieldName = (fieldId: string) => `f-${formId}-${fieldId}`;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const field of ordered) seed[field.id] = initial?.fields[field.id] ?? '';
    return seed;
  });
  const [custom, setCustom] = useState<CustomField[]>(initial?.custom ?? []);
  const [folderId, setFolderId] = useState<string | null>(initial?.folderId ?? null);
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = ordered.filter((f) => f.required && !values[f.id]?.trim());
  const canSubmit = title.trim().length > 0 && missing.length === 0 && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ title: title.trim(), fields: values, custom, folderId, tagIds });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label style={labelStyle}>
        Title
        <input
          name={fieldName('title')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          style={inputStyle}
        />
        <small style={{ color: 'var(--muted)' }}>
          Encrypted like everything else — the server cannot read it, so search runs on your device.
        </small>
      </label>

      {ordered.map((field) => (
        <label key={field.id} style={labelStyle}>
          {field.label}
          {field.required && <span aria-hidden="true"> *</span>}
          {field.type === 'multiline' ? (
            <textarea
              name={fieldName(field.id)}
              value={values[field.id] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
              rows={4}
              required={field.required}
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          ) : (
            <input
              type={inputTypeFor(field.type)}
              name={fieldName(field.id)}
              value={values[field.id] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
              required={field.required}
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              style={inputStyle}
            />
          )}
          {field.sensitive && (
            <small style={{ color: 'var(--muted)' }}>Masked in lists and on the detail view.</small>
          )}
        </label>
      ))}

      <CustomFields fields={custom} onChange={setCustom} formId={formId} />

      {/*
        Filing is separated from the fields above by a rule, because the two come from
        different places: the fields are defined by the template and vary by secret type,
        while folder and tags apply to every secret regardless of type.
      */}
      {filing && (filing.folders.length > 0 || filing.tags.length > 0) && (
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Filing</legend>

          {filing.folders.length > 0 && (
            <label style={{ display: 'block', marginBottom: '0.6rem' }}>
              Folder
              <select
                value={folderId ?? ''}
                onChange={(e) => setFolderId(e.target.value || null)}
                style={{ ...inputStyle, maxWidth: '18rem' }}
              >
                <option value="">Unfiled</option>
                {filing.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {filing.tags.length > 0 && (
            <div>
              <span style={{ fontSize: '0.9rem' }}>Tags</span>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
                {filing.tags.map((tag) => {
                  const on = tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setTagIds((current) =>
                          on ? current.filter((t) => t !== tag.id) : [...current, tag.id],
                        )
                      }
                      style={{
                        padding: '0.2rem 0.55rem',
                        fontSize: '0.85rem',
                        borderRadius: 999,
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                        background: on ? 'var(--accent)' : 'transparent',
                        color: on ? '#fff' : 'var(--fg)',
                        cursor: 'pointer',
                      }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </fieldset>
      )}

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="submit" disabled={!canSubmit} style={primaryButton(canSubmit)}>
          {busy ? 'Encrypting…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '0.85rem' };

const fieldsetStyle: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid var(--border)',
  padding: '0.75rem 0 0',
  margin: '0.25rem 0 0.85rem',
};

const legendStyle: React.CSSProperties = {
  padding: 0,
  fontSize: '0.85rem',
  color: 'var(--muted)',
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.5rem 0.65rem',
  marginTop: '0.25rem',
  fontSize: '1rem',
  border: '1px solid var(--border)',
  borderRadius: 5,
  background: 'var(--bg)',
  color: 'var(--fg)',
};

const primaryButton = (enabled: boolean): React.CSSProperties => ({
  padding: '0.55rem 1rem',
  fontSize: '1rem',
  borderRadius: 5,
  border: 'none',
  background: enabled ? 'var(--accent)' : 'var(--border)',
  color: enabled ? '#fff' : 'var(--muted)',
  cursor: enabled ? 'pointer' : 'not-allowed',
});

const secondaryButton: React.CSSProperties = {
  padding: '0.55rem 1rem',
  fontSize: '1rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};
