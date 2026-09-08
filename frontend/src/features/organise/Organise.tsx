/**
 * Folder and tag management (T071).
 *
 * Names are encrypted like everything else, so they are created and renamed here rather than
 * anywhere the server could read them.
 *
 * Deleting a folder demands an explicit disposition (FR-048). There is no default: cascading
 * silently destroys secrets, and orphaning silently hides them from anyone who navigates by
 * folder. Neither is safe to pick on the user's behalf, so the dialog makes them choose and
 * says what each choice does.
 */
import { useState } from 'react';
import type { Envelope, FolderName, TagName } from '@pm/shared';
import { api } from '../../api/client.js';
import { encrypt } from '../../crypto/envelope.js';
import { writeKeyFor } from '../../vault/keyring.js';
import type { NamedItem } from '../vault-list/Filters.js';

export function Organise({
  vaultId,
  folders,
  tags,
  folderCounts,
  onChanged,
}: {
  vaultId: string;
  folders: NamedItem[];
  tags: NamedItem[];
  folderCounts: Map<string, number>;
  onChanged: () => Promise<void>;
}) {
  const [newFolder, setNewFolder] = useState('');
  const [newTag, setNewTag] = useState('');
  const [deleting, setDeleting] = useState<NamedItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(kind: 'folders' | 'tags', name: string) {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { key } = writeKeyFor(vaultId);
      const sealed =
        kind === 'folders'
          ? await encrypt<FolderName>(key, name.trim())
          : await encrypt<TagName>(key, name.trim());
      await api('POST', `/vaults/${vaultId}/${kind}`, { name: sealed as Envelope<unknown> });
      if (kind === 'folders') setNewFolder('');
      else setNewTag('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function removeFolder(folder: NamedItem, disposition: 'orphan' | 'cascade') {
    setBusy(true);
    try {
      await api('DELETE', `/vaults/${vaultId}/folders/${folder.id}?disposition=${disposition}`);
      setDeleting(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the folder.');
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tag: NamedItem) {
    setBusy(true);
    try {
      await api('DELETE', `/vaults/${vaultId}/tags/${tag.id}`);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the tag.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Folders and tags</h2>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <h3 style={heading}>Folders</h3>
      <p style={note}>A secret sits in one folder, or none.</p>
      <ul style={list}>
        {folders.map((folder) => (
          <li key={folder.id} style={row}>
            <span>{folder.name}</span>
            <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
              {folderCounts.get(folder.id) ?? 0} secrets
            </span>
            <button type="button" onClick={() => setDeleting(folder)} style={dangerLink}>
              Delete
            </button>
          </li>
        ))}
        {folders.length === 0 && <li style={{ color: 'var(--muted)' }}>No folders yet.</li>}
      </ul>
      <NewItem
        value={newFolder}
        onChange={setNewFolder}
        onSubmit={() => void create('folders', newFolder)}
        placeholder="New folder name"
        busy={busy}
      />

      <h3 style={heading}>Tags</h3>
      <p style={note}>A secret can carry any number of tags. Deleting a tag removes the label only.</p>
      <ul style={list}>
        {tags.map((tag) => (
          <li key={tag.id} style={row}>
            <span>{tag.name}</span>
            <span />
            <button type="button" onClick={() => void removeTag(tag)} style={dangerLink}>
              Delete
            </button>
          </li>
        ))}
        {tags.length === 0 && <li style={{ color: 'var(--muted)' }}>No tags yet.</li>}
      </ul>
      <NewItem
        value={newTag}
        onChange={setNewTag}
        onSubmit={() => void create('tags', newTag)}
        placeholder="New tag name"
        busy={busy}
      />

      {deleting && (
        <div role="dialog" aria-modal="true" style={backdrop}>
          <div style={panel}>
            <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>Delete folder “{deleting.name}”?</h3>
            <p style={{ fontSize: '0.92rem' }}>
              It holds <strong>{folderCounts.get(deleting.id) ?? 0}</strong> secret
              {(folderCounts.get(deleting.id) ?? 0) === 1 ? '' : 's'}. Choose what happens to them.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeFolder(deleting, 'orphan')}
                style={choiceButton}
              >
                <strong>Keep the secrets</strong>
                <small style={{ display: 'block', color: 'var(--muted)' }}>
                  They stay in the vault, unfiled. Nothing is lost.
                </small>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeFolder(deleting, 'cascade')}
                style={{ ...choiceButton, borderColor: 'var(--danger)' }}
              >
                <strong style={{ color: 'var(--danger)' }}>Delete the secrets too</strong>
                <small style={{ display: 'block', color: 'var(--muted)' }}>
                  Permanent and irreversible. There is no trash and no restore.
                </small>
              </button>
              <button type="button" onClick={() => setDeleting(null)} style={cancelButton}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function NewItem({
  value,
  onChange,
  onSubmit,
  placeholder,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          flex: 1,
          padding: '0.45rem 0.6rem',
          fontSize: '0.95rem',
          border: '1px solid var(--border)',
          borderRadius: 5,
          background: 'var(--bg)',
          color: 'var(--fg)',
        }}
      />
      <button type="submit" disabled={busy || !value.trim()} style={addButton(!busy && !!value.trim())}>
        Add
      </button>
    </form>
  );
}

const heading: React.CSSProperties = { fontSize: '1rem', margin: '1.25rem 0 0.2rem' };
const note: React.CSSProperties = { color: 'var(--muted)', fontSize: '0.88rem', margin: '0 0 0.5rem' };
const list: React.CSSProperties = { listStyle: 'none', padding: 0, margin: '0 0 0.6rem' };

const row: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto',
  gap: '0.75rem',
  alignItems: 'center',
  padding: '0.35rem 0',
  borderBottom: '1px solid var(--border)',
};

const dangerLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--danger)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.85rem',
};

const addButton = (enabled: boolean): React.CSSProperties => ({
  padding: '0.45rem 0.9rem',
  borderRadius: 5,
  border: 'none',
  background: enabled ? 'var(--accent)' : 'var(--border)',
  color: enabled ? '#fff' : 'var(--muted)',
  cursor: enabled ? 'pointer' : 'not-allowed',
});

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

const choiceButton: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.6rem 0.75rem',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};

const cancelButton: React.CSSProperties = {
  padding: '0.5rem 0.9rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};
