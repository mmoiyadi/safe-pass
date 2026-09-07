/**
 * Per-secret custom fields (T120, FR-039).
 *
 * One secret often needs a field no template should carry: the security questions a single bank
 * asked, the account number one insurer uses. Changing the template for everyone is the wrong
 * shape for that, so a secret may carry extra fields of its own.
 *
 * ## Where the label lives
 *
 * A field's *label* is user data. "Recovery phrase", "Offshore account", "Ex-wife's maiden name"
 * — a server that learns those learns a great deal without decrypting a single value. So custom
 * fields are NOT stored as extra JSONB keys, which would put every label in the clear in the
 * database and in every backup of it.
 *
 * Instead the whole set is packed into one JSON document, encrypted as a unit, and stored under
 * a single reserved key. The server sees one more opaque envelope under a fixed, meaningless
 * name; it learns that a secret has custom fields, and nothing else — not how many, not what
 * they are called, not what is in them.
 *
 * This also costs nothing elsewhere: the rotation worker re-encrypts every entry of
 * `fieldValues` generically, so these rotate with the vault like any other value, and the
 * backend already accepts any field id whose value is a well-formed envelope.
 */
import { useState } from 'react';

/**
 * The reserved `fieldValues` key. Prefixed to keep it out of the slug space the template editor
 * generates, so a user-defined field can never collide with it.
 */
export const CUSTOM_FIELDS_KEY = '__custom';

export interface CustomField {
  id: string;
  label: string;
  value: string;
  /** Masks it in the detail view. Every value is encrypted regardless (FR-041). */
  sensitive: boolean;
}

/** Packs the set for encryption. Returns null when there is nothing to store. */
export function encodeCustomFields(fields: CustomField[]): string | null {
  const kept = fields.filter((f) => f.label.trim() !== '' || f.value !== '');
  return kept.length === 0 ? null : JSON.stringify(kept);
}

/**
 * Unpacks a decrypted blob.
 *
 * Anything malformed yields an empty set rather than throwing: this runs while rendering a
 * secret, and a secret whose custom fields cannot be parsed should still show everything else
 * rather than failing to open at all.
 */
export function decodeCustomFields(plaintext: string | undefined): CustomField[] {
  if (!plaintext) return [];
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
      .map((f, i) => ({
        id: typeof f['id'] === 'string' ? f['id'] : `c${i}`,
        label: typeof f['label'] === 'string' ? f['label'] : '',
        value: typeof f['value'] === 'string' ? f['value'] : '',
        sensitive: f['sensitive'] === true,
      }));
  } catch {
    return [];
  }
}

const newId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Editing form, used inside the secret form. */
export function CustomFields({
  fields,
  onChange,
  formId,
}: {
  fields: CustomField[];
  onChange: (fields: CustomField[]) => void;
  /** Randomised name prefix, so browser autofill heuristics cannot recognise these inputs. */
  formId: string;
}) {
  const patch = (id: string, change: Partial<CustomField>) =>
    onChange(fields.map((f) => (f.id === id ? { ...f, ...change } : f)));

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Extra fields</legend>
      <p style={note}>
        Only on this secret. Adding one here does not change the template or any other secret
        that uses it.
      </p>

      {fields.map((field) => (
        <div key={field.id} style={row}>
          <input
            name={`x-${formId}-${field.id}-l`}
            value={field.label}
            onChange={(e) => patch(field.id, { label: e.target.value })}
            placeholder="Field name"
            aria-label="Field name"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            style={{ ...input, flex: '1 1 9rem' }}
          />
          <input
            type={field.sensitive ? 'password' : 'text'}
            name={`x-${formId}-${field.id}-v`}
            value={field.value}
            onChange={(e) => patch(field.id, { value: e.target.value })}
            placeholder="Value"
            aria-label="Value"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            style={{ ...input, flex: '2 1 12rem' }}
          />
          <label style={checkbox}>
            <input
              type="checkbox"
              checked={field.sensitive}
              onChange={(e) => patch(field.id, { sensitive: e.target.checked })}
            />
            Hide
          </label>
          <button
            type="button"
            onClick={() => onChange(fields.filter((f) => f.id !== field.id))}
            style={link}
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...fields, { id: newId(), label: '', value: '', sensitive: false }])}
        style={ghost}
      >
        + Add a field to this secret
      </button>
    </fieldset>
  );
}

/** Read-only rendering for the detail view, with sensitive values masked until revealed. */
export function CustomFieldList({ fields }: { fields: CustomField[] }) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  const named = fields.filter((f) => f.label.trim() !== '');
  if (named.length === 0) return null;

  const toggle = (id: string) =>
    setShown((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <dl style={{ margin: '0.5rem 0' }}>
      {named.map((field) => (
        <div key={field.id} style={{ display: 'flex', gap: '0.5rem', padding: '0.2rem 0' }}>
          <dt style={{ color: 'var(--muted)', minWidth: '8rem', fontSize: '0.9rem' }}>{field.label}</dt>
          <dd style={{ margin: 0, fontSize: '0.9rem', wordBreak: 'break-all' }}>
            {field.sensitive && !shown.has(field.id) ? (
              <>
                <span aria-label="hidden value">••••••••</span>{' '}
                <button type="button" onClick={() => toggle(field.id)} style={link}>
                  Reveal
                </button>
              </>
            ) : (
              <>
                {field.value || <span style={{ color: 'var(--muted)' }}>empty</span>}
                {field.sensitive && (
                  <>
                    {' '}
                    <button type="button" onClick={() => toggle(field.id)} style={link}>
                      Hide
                    </button>
                  </>
                )}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const fieldset: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '0.6rem 0.8rem',
  margin: '0.9rem 0',
};

const legend: React.CSSProperties = { padding: '0 0.35rem', fontSize: '0.9rem', color: 'var(--muted)' };
const note: React.CSSProperties = { margin: '0 0 0.6rem', fontSize: '0.85rem', color: 'var(--muted)' };

const row: React.CSSProperties = {
  display: 'flex',
  gap: '0.4rem',
  alignItems: 'center',
  flexWrap: 'wrap',
  marginBottom: '0.4rem',
};

const checkbox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  fontSize: '0.85rem',
  color: 'var(--muted)',
};

const input: React.CSSProperties = {
  padding: '0.4rem 0.55rem',
  fontSize: '0.92rem',
  border: '1px solid var(--border)',
  borderRadius: 5,
  background: 'var(--bg)',
  color: 'var(--fg)',
  minWidth: 0,
};

const ghost: React.CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
  fontSize: '0.88rem',
};

const link: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--accent)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.85rem',
};
