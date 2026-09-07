/**
 * Template editor (T118, T119, T120, FR-039, FR-042).
 *
 * Defining a secret type here writes a row. No migration, no deploy — which is what
 * Constitution Principle V is for, and what makes "add a custom field" a thing a user can do
 * rather than a thing they file a request for.
 *
 * Editing an existing template asks the server what the change would cost first. Removing a
 * field does not delete the stored values, but nothing would render them, which from the user's
 * side is indistinguishable from losing them. Saying so beforehand is the whole point.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { FieldType, TemplateField, TemplateVersionRecord } from '@pm/shared';
import { api } from '../../api/client.js';
import { ChangeWarning, type Impact } from './ChangeWarning.js';

const TYPES: Array<{ value: FieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'password', label: 'Password' },
  { value: 'email', label: 'Email address' },
  { value: 'url', label: 'Web address' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'multiline', label: 'Long text' },
  { value: 'totp', label: 'One-time code' },
];

interface Draft extends TemplateField {
  key: string;
}

const slug = (label: string): string =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${Date.now()}`;

export function TemplateEditor({
  templates,
  onChanged,
}: {
  templates: TemplateVersionRecord[];
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ templateId: string | null; name: string; fields: Draft[] } | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set once the user has submitted a change that would orphan values, and is being asked. */
  const [confirming, setConfirming] = useState(false);

  /** Fields of the version under edit, so the warning can name fields rather than slugs. */
  const editedTemplateFields =
    templates.find((t) => t.templateId === editing?.templateId)?.fields ?? [];

  const custom = templates.filter((t) => t.kind === 'custom');
  const builtin = templates.filter((t) => t.kind === 'builtin');

  const startNew = () =>
    setEditing({
      templateId: null,
      name: '',
      fields: [
        { key: 'f1', id: 'field_1', label: '', type: 'text', required: false, sensitive: false, order: 0 },
      ],
    });

  const startEdit = (template: TemplateVersionRecord) =>
    setEditing({
      templateId: template.templateId,
      name: template.name,
      fields: template.fields.map((f, i) => ({ ...f, key: `k${i}` })),
    });

  const update = useCallback((key: string, patch: Partial<Draft>) => {
    setConfirming(false);
    setEditing((current) =>
      current
        ? { ...current, fields: current.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) }
        : current,
    );
  }, []);

  /** Asks the server what would be orphaned, before anything is written. */
  useEffect(() => {
    if (!editing?.templateId) {
      setImpact(null);
      return;
    }
    const handle = setTimeout(() => {
      void api<Impact>('POST', `/templates/${editing.templateId}/impact`, {
        fields: editing.fields.map(({ key: _key, ...f }) => ({ ...f, id: f.id || slug(f.label) })),
      })
        .then(setImpact)
        .catch(() => setImpact(null));
    }, 400);
    return () => clearTimeout(handle);
  }, [editing]);

  /** The proposed version, in the shape both the impact check and the save use. */
  const proposedFields = (draft: NonNullable<typeof editing>) =>
    draft.fields.map(({ key: _key, ...f }, index) => ({
      ...f,
      id: f.id || slug(f.label),
      order: index,
    }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setError(null);

    /*
     * The advisory note is debounced, and a debounced warning is not a safeguard: removing a
     * field and hitting Save inside the debounce window would have skipped the confirmation
     * entirely and stranded the values silently. Found by the end-to-end test, which clicks
     * faster than a person but not faster than a person in a hurry.
     *
     * So the check is re-run here, awaited, against the draft actually being submitted. The
     * state above stays for the live note; this is what decides.
     */
    if (editing.templateId) {
      setBusy(true);
      try {
        const fresh = await api<Impact>('POST', `/templates/${editing.templateId}/impact`, {
          fields: proposedFields(editing),
        });
        setImpact(fresh);
        if (fresh.affectedSecrets > 0) {
          setConfirming(true);
          return;
        }
      } catch {
        // Could not find out what the change would cost. Saving anyway might strand values
        // without ever saying so, which is the one outcome this whole path exists to prevent.
        setError(
          'Could not check what this change would affect, so nothing has been saved. ' +
            'Check your connection and try again.',
        );
        return;
      } finally {
        setBusy(false);
      }
    }

    void save();
  }

  async function save() {
    if (!editing) return;
    setError(null);
    setBusy(true);
    try {
      const payload = { name: editing.name.trim(), fields: proposedFields(editing) };
      if (editing.templateId) await api('PUT', `/templates/${editing.templateId}`, payload);
      else await api('POST', '/templates', payload);

      setEditing(null);
      setImpact(null);
      setConfirming(false);
      await onChanged();
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? err.message : 'Could not save the template.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(template: TemplateVersionRecord) {
    setError(null);
    try {
      await api('DELETE', `/templates/${template.templateId}`);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
    }
  }

  return (
    <section>
      <h2>Secret types</h2>
      <p style={note}>
        A secret type is just a list of fields. Defining one takes effect immediately — nothing
        is deployed and no data is migrated.
      </p>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!editing && (
        <>
          <h3 style={heading}>Your own</h3>
          <ul style={list}>
            {custom.map((t) => (
              <li key={t.templateId} style={row}>
                <span>
                  {t.name}
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}· {t.fields.length} field{t.fields.length === 1 ? '' : 's'} · version{' '}
                    {t.version}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: '0.6rem' }}>
                  <button type="button" onClick={() => startEdit(t)} style={link}>Edit</button>
                  <button type="button" onClick={() => void remove(t)} style={{ ...link, color: 'var(--danger)' }}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
            {custom.length === 0 && <li style={{ color: 'var(--muted)' }}>None yet.</li>}
          </ul>
          <button type="button" onClick={startNew} style={primary}>Define a secret type</button>

          <h3 style={heading}>Built in</h3>
          <ul style={list}>
            {builtin.map((t) => (
              <li key={t.id} style={{ ...row, color: 'var(--muted)' }}>
                <span>
                  {t.name} · {t.fields.length} field{t.fields.length === 1 ? '' : 's'}
                </span>
                <span style={{ fontSize: '0.85rem' }}>cannot be changed</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <form onSubmit={(e) => void submit(e)}>
          <h3 style={heading}>{editing.templateId ? 'Edit' : 'New'} secret type</h3>

          <label style={{ display: 'block', marginBottom: '0.85rem' }}>
            Name
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              required
              autoFocus
              autoComplete="off"
              style={input}
            />
          </label>

          {editing.fields.map((field, index) => (
            <div key={field.key} style={fieldRow}>
              <input
                value={field.label}
                onChange={(e) => update(field.key, { label: e.target.value, id: field.id || slug(e.target.value) })}
                placeholder="Field name"
                required
                autoComplete="off"
                style={{ ...input, marginTop: 0 }}
              />
              <select
                value={field.type}
                onChange={(e) => update(field.key, { type: e.target.value as FieldType })}
                style={{ ...input, marginTop: 0 }}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <label style={checkbox}>
                <input
                  type="checkbox"
                  checked={field.sensitive}
                  onChange={(e) => update(field.key, { sensitive: e.target.checked })}
                />
                Hide by default
              </label>
              <label style={checkbox}>
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => update(field.key, { required: e.target.checked })}
                />
                Required
              </label>
              <button
                type="button"
                onClick={() =>
                  setEditing({ ...editing, fields: editing.fields.filter((f) => f.key !== field.key) })
                }
                disabled={editing.fields.length === 1}
                style={{ ...link, color: 'var(--danger)' }}
              >
                Remove
              </button>
              <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>#{index + 1}</span>
            </div>
          ))}

          <button
            type="button"
            onClick={() =>
              setEditing({
                ...editing,
                fields: [
                  ...editing.fields,
                  {
                    key: `k${Date.now()}`,
                    id: '',
                    label: '',
                    type: 'text',
                    required: false,
                    sensitive: false,
                    order: editing.fields.length,
                  },
                ],
              })
            }
            style={ghost}
          >
            + Add a field
          </button>

          <p style={note}>
            “Hide by default” masks the value in lists and on the detail view. It does not decide
            whether the value is encrypted — everything is, always.
          </p>

          {/*
            While the user is still typing this stays a one-line note. It only becomes a
            question they have to answer once they try to save — warning on every keystroke
            would teach them to click past it, which is the opposite of the point.
          */}
          {impact && impact.removedFields.length > 0 && !confirming && (
            <p style={{ color: 'var(--warn)', fontSize: '0.9rem' }}>
              This removes {impact.removedFields.length} field
              {impact.removedFields.length === 1 ? '' : 's'}.{' '}
              {impact.affectedSecrets > 0
                ? `${impact.affectedSecrets} secret${impact.affectedSecrets === 1 ? '' : 's'} ` +
                  `already ${impact.affectedSecrets === 1 ? 'holds' : 'hold'} values there — ` +
                  `we will confirm before saving.`
                : 'No stored values are affected.'}
            </p>
          )}

          {confirming && impact && (
            <ChangeWarning
              impact={impact}
              knownFields={editedTemplateFields}
              busy={busy}
              onConfirm={() => void save()}
              onCancel={() => setConfirming(false)}
            />
          )}

          {editing.templateId && (
            <p style={note}>
              Saving creates a new version. Secrets written under the current one keep rendering
              exactly as they are.
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button type="submit" disabled={busy || !editing.name.trim()} style={primary}>
              {busy ? 'Saving…' : editing.templateId ? 'Save as a new version' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(null); setImpact(null); setConfirming(false); }}
              style={ghost}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const heading: React.CSSProperties = { fontSize: '1rem', margin: '1.25rem 0 0.3rem' };
const note: React.CSSProperties = { color: 'var(--muted)', fontSize: '0.88rem', margin: '0.5rem 0' };
const list: React.CSSProperties = { listStyle: 'none', padding: 0, margin: '0 0 0.6rem' };

const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.75rem',
  alignItems: 'center',
  padding: '0.4rem 0',
  borderBottom: '1px solid var(--border)',
  fontSize: '0.92rem',
};

const fieldRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
  flexWrap: 'wrap',
  padding: '0.4rem 0',
  borderBottom: '1px solid var(--border)',
};

const checkbox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  fontSize: '0.85rem',
  color: 'var(--muted)',
  whiteSpace: 'nowrap',
};

const input: React.CSSProperties = {
  padding: '0.45rem 0.6rem',
  marginTop: '0.25rem',
  fontSize: '0.95rem',
  border: '1px solid var(--border)',
  borderRadius: 5,
  background: 'var(--bg)',
  color: 'var(--fg)',
};

const primary: React.CSSProperties = {
  padding: '0.5rem 1rem',
  borderRadius: 5,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  cursor: 'pointer',
};

const ghost: React.CSSProperties = {
  padding: '0.45rem 0.9rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
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
