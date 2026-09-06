/**
 * Vault contents (T066), with search and filtering (T070, T072).
 *
 * Presentation is driven entirely by the secret's TemplateVersion. A credit card shows its
 * cardholder and a masked number; a secure note shows an excerpt. None of that is special-cased
 * by type name — the list reads the template's fields and applies each field's `sensitive` flag.
 * A template added tomorrow renders correctly with no change here (Principle V).
 *
 * Search and filtering both run over already-decrypted material held in memory, because the
 * server stores ciphertext and cannot do either (research.md §4).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  SecretFieldValue,
  SecretRecord,
  SecretTitle,
  TemplateField,
  TemplateVersionRecord,
} from '@pm/shared';
import { api } from '../../api/client.js';
import { decrypt, encrypt } from '../../crypto/envelope.js';
import { vaultKeyFor, writeKeyFor } from '../../vault/keyring.js';
import { searchIndex, type SearchHit } from '../../search/index.js';
import { SensitiveField } from '../../components/SensitiveField.js';
import { CopyButton } from '../../components/CopyButton.js';
import { TemplateForm, type TemplateFormValues } from '../templates/TemplateForm.js';
import { DeleteDialog } from '../secret-detail/DeleteDialog.js';
import { SearchBar } from '../search/SearchBar.js';
import { Filters, UNFILED, type FilterState, type NamedItem } from './Filters.js';

interface DecryptedSecret {
  id: string;
  title: string;
  templateVersionId: string;
  revision: number;
  keyVersion: number;
  folderId: string | null;
  tagIds: string[];
  fields: Record<string, string>;
}

export function SecretList({
  vaultId,
  templates,
  shared,
  onDataChanged,
}: {
  vaultId: string;
  templates: TemplateVersionRecord[];
  shared: boolean;
  onDataChanged?: (folders: NamedItem[], tags: NamedItem[], folderCounts: Map<string, number>) => void;
}) {
  const [items, setItems] = useState<DecryptedSecret[]>([]);
  const [folders, setFolders] = useState<NamedItem[]>([]);
  const [tags, setTags] = useState<NamedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<TemplateVersionRecord | null>(null);
  const [editing, setEditing] = useState<DecryptedSecret | null>(null);
  const [deleting, setDeleting] = useState<DecryptedSecret | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>({ folderId: null, tagIds: [] });

  const byId = useMemo(() => new Map(templates.map((t) => [t.id, t] as const)), [templates]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, folderRows, tagRows] = await Promise.all([
        api<SecretRecord[]>('GET', `/vaults/${vaultId}/secrets`),
        api<Array<{ id: string; name: string; keyVersion: number }>>('GET', `/vaults/${vaultId}/folders`),
        api<Array<{ id: string; name: string; keyVersion: number }>>('GET', `/vaults/${vaultId}/tags`),
      ]);

      const decryptedFolders: NamedItem[] = [];
      for (const f of folderRows) {
        decryptedFolders.push({ id: f.id, name: await decrypt(vaultKeyFor(vaultId, f.keyVersion), f.name as never) });
      }
      const decryptedTags: NamedItem[] = [];
      for (const t of tagRows) {
        decryptedTags.push({ id: t.id, name: await decrypt(vaultKeyFor(vaultId, t.keyVersion), t.name as never) });
      }

      const out: DecryptedSecret[] = [];
      for (const row of rows) {
        // Key selected by THIS ROW's generation, not the vault's current one.
        const key = vaultKeyFor(vaultId, row.keyVersion);
        const fields: Record<string, string> = {};
        for (const [fieldId, envelope] of Object.entries(row.fieldValues)) {
          fields[fieldId] = await decrypt(key, envelope);
        }
        out.push({
          id: row.id,
          title: await decrypt(key, row.title),
          templateVersionId: row.templateVersionId,
          revision: row.revision,
          keyVersion: row.keyVersion,
          folderId: row.folderId,
          tagIds: row.tagIds,
          fields,
        });
      }

      setItems(out);
      setFolders(decryptedFolders);
      setTags(decryptedTags);
      setError(null);
    } catch {
      setError('Could not load this vault.');
    } finally {
      setLoading(false);
    }
  }, [vaultId]);

  useEffect(() => void load(), [load]);

  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const tagName = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);

  /**
   * Rebuilt whenever the decrypted set changes. Sensitive field values are deliberately
   * EXCLUDED: FR-044 scopes search to titles and non-sensitive attributes, and a search box
   * that matched on stored passwords would turn a shoulder-surfed keystroke into a lookup.
   */
  useEffect(() => {
    searchIndex.build(
      items.map((item) => {
        const template = byId.get(item.templateVersionId);
        const fields = (template?.fields ?? []) as TemplateField[];
        const searchable: Record<string, string> = {};
        for (const field of fields) {
          if (!field.sensitive && item.fields[field.id]) searchable[field.id] = item.fields[field.id]!;
        }
        return {
          id: item.id,
          title: item.title,
          searchableFields: searchable,
          folderName: item.folderId ? (folderName.get(item.folderId) ?? null) : null,
          tagNames: item.tagIds.map((t) => tagName.get(t) ?? '').filter(Boolean),
          templateName: template?.name ?? '',
        };
      }),
    );
    return () => searchIndex.clear();
  }, [items, byId, folderName, tagName]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.folderId) counts.set(item.folderId, (counts.get(item.folderId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const t of item.tagIds) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  useEffect(() => {
    onDataChanged?.(folders, tags, folderCounts);
  }, [folders, tags, folderCounts, onDataChanged]);

  const hits: Map<string, SearchHit> | null = useMemo(() => {
    if (!query.trim()) return null;
    return new Map(searchIndex.search(query).map((h) => [h.id, h] as const));
  }, [query, items]);

  const visible = useMemo(() => {
    let result = items;

    if (filters.folderId === UNFILED) result = result.filter((i) => i.folderId === null);
    else if (filters.folderId) result = result.filter((i) => i.folderId === filters.folderId);

    // Multiple tags narrow rather than widen.
    if (filters.tagIds.length > 0) {
      result = result.filter((i) => filters.tagIds.every((t) => i.tagIds.includes(t)));
    }

    if (hits) {
      result = result.filter((i) => hits.has(i.id));
      result = [...result].sort((a, b) => (hits.get(b.id)!.score - hits.get(a.id)!.score));
    }

    return result;
  }, [items, filters, hits]);

  async function encryptValues(template: TemplateVersionRecord, values: TemplateFormValues) {
    const { key, keyVersion } = writeKeyFor(vaultId);
    const fieldValues: Record<string, string> = {};
    for (const field of template.fields as TemplateField[]) {
      // Every value is encrypted, sensitive or not. `sensitive` drives masking, not encryption.
      fieldValues[field.id] = await encrypt<SecretFieldValue>(key, values.fields[field.id] ?? '');
    }
    return { title: await encrypt<SecretTitle>(key, values.title), fieldValues, keyVersion };
  }

  async function create(template: TemplateVersionRecord, values: TemplateFormValues) {
    const payload = await encryptValues(template, values);
    await api('POST', `/vaults/${vaultId}/secrets`, {
      templateVersionId: template.id,
      ...payload,
      folderId: values.folderId,
      tagIds: values.tagIds,
    });
    setAdding(null);
    await load();
  }

  async function update(secret: DecryptedSecret, values: TemplateFormValues) {
    const template = byId.get(secret.templateVersionId);
    if (!template) throw new Error('Unknown template for this secret');
    const payload = await encryptValues(template, values);
    try {
      await api('PUT', `/vaults/${vaultId}/secrets/${secret.id}`, {
        templateVersionId: secret.templateVersionId,
        ...payload,
        folderId: values.folderId,
        tagIds: values.tagIds,
        revision: secret.revision,
      });
    } catch (err) {
      // The second save must never silently discard the first.
      if (err instanceof Error && err.message.includes('changed since')) {
        throw new Error(
          'Someone else changed this secret while you were editing. Close and reopen it to see ' +
            'their version before saving again.',
        );
      }
      throw err;
    }
    setEditing(null);
    await load();
  }

  /** Filing and tagging are metadata moves; they do not touch the encrypted payload. */
  async function file(secret: DecryptedSecret, folderId: string | null) {
    const template = byId.get(secret.templateVersionId);
    if (!template) return;
    const payload = await encryptValues(template, {
      title: secret.title,
      fields: secret.fields,
      folderId,
      tagIds: secret.tagIds,
    });
    await api('PUT', `/vaults/${vaultId}/secrets/${secret.id}`, {
      templateVersionId: secret.templateVersionId,
      ...payload,
      folderId,
      // Omitted deliberately would also work, but sending the current set makes it explicit
      // that a re-file must not disturb the tags.
      tagIds: secret.tagIds,
      revision: secret.revision,
    });
    await load();
  }

  async function toggleTag(secret: DecryptedSecret, tagId: string) {
    const next = secret.tagIds.includes(tagId)
      ? secret.tagIds.filter((t) => t !== tagId)
      : [...secret.tagIds, tagId];
    await api('PUT', `/vaults/${vaultId}/secrets/${secret.id}/tags`, { tagIds: next });
    await load();
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Decrypting…</p>;

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <h2 style={{ margin: '0 0 0.75rem' }}>Secrets</h2>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <SearchBar
        onQueryChange={setQuery}
        resultCount={hits ? visible.length : null}
        totalCount={items.length}
      />

      <Filters
        folders={folders}
        tags={tags}
        state={filters}
        counts={{ byFolder: folderCounts, byTag: tagCounts, unfiled: items.filter((i) => !i.folderId).length }}
        onChange={setFilters}
      />

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {visible.map((item) => {
          const template = byId.get(item.templateVersionId);
          const hit = hits?.get(item.id);
          return (
            <li key={item.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{item.title}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                    {template?.name ?? 'Unknown type'}
                    {item.folderId && ` · ${folderName.get(item.folderId) ?? ''}`}
                    {hit && hit.matchedIn !== 'title' && ` · matched in ${hit.matchedIn}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button type="button" onClick={() => setEditing(item)} style={miniButton}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(item)}
                    style={{ ...miniButton, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {template && (
                <dl style={{ margin: '0.6rem 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.35rem 0.75rem' }}>
                  {[...(template.fields as TemplateField[])]
                    .sort((a, b) => a.order - b.order)
                    .filter((f) => (item.fields[f.id] ?? '').length > 0)
                    .map((field) => (
                      <FieldRow key={field.id} field={field} value={item.fields[field.id] ?? ''} />
                    ))}
                </dl>
              )}

              {(folders.length > 0 || tags.length > 0) && (
                <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {folders.length > 0 && (
                    <label style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                      Folder{' '}
                      <select
                        value={item.folderId ?? ''}
                        onChange={(e) => void file(item, e.target.value || null)}
                        style={select}
                      >
                        <option value="">Unfiled</option>
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {tags.map((tag) => {
                    const on = item.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => void toggleTag(item, tag.id)}
                        aria-pressed={on}
                        style={{
                          padding: '0.15rem 0.5rem',
                          fontSize: '0.8rem',
                          borderRadius: 999,
                          border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                          background: on ? 'var(--accent)' : 'transparent',
                          color: on ? '#fff' : 'var(--muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}

        {visible.length === 0 && items.length > 0 && (
          <li style={{ color: 'var(--muted)', padding: '0.5rem 0' }}>
            Nothing matches. {query && <>Try a shorter search, or </>}clear the filters.
          </li>
        )}
        {items.length === 0 && (
          <li style={{ color: 'var(--muted)', padding: '0.5rem 0' }}>Nothing stored yet.</li>
        )}
      </ul>

      <div style={{ borderTop: '1px solid var(--border)', marginTop: '1.25rem', paddingTop: '1rem' }}>
        {!adding && !editing && (
          <>
            <h3 style={{ margin: '0 0 0.6rem', fontSize: '1rem' }}>Add a secret</h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {templates.map((t) => (
                <button key={t.id} type="button" onClick={() => setAdding(t)} style={miniButton}>
                  {t.name}
                </button>
              ))}
            </div>
          </>
        )}

        {adding && (
          <>
            <h3 style={{ margin: '0 0 0.6rem', fontSize: '1rem' }}>New {adding.name}</h3>
            <TemplateForm
              template={adding}
              filing={{ folders, tags }}
              onSubmit={(v) => create(adding, v)}
              onCancel={() => setAdding(null)}
            />
          </>
        )}

        {editing && byId.get(editing.templateVersionId) && (
          <>
            <h3 style={{ margin: '0 0 0.6rem', fontSize: '1rem' }}>Edit “{editing.title}”</h3>
            <TemplateForm
              template={byId.get(editing.templateVersionId)!}
              initial={{
                title: editing.title,
                fields: editing.fields,
                folderId: editing.folderId,
                tagIds: editing.tagIds,
              }}
              filing={{ folders, tags }}
              submitLabel="Save changes"
              onSubmit={(v) => update(editing, v)}
              onCancel={() => setEditing(null)}
            />
          </>
        )}
      </div>

      {deleting && (
        <DeleteDialog
          title={deleting.title}
          shared={shared}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await api('DELETE', `/vaults/${vaultId}/secrets/${deleting.id}`);
            setDeleting(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

/** One field row. Masking and copy availability both follow the field's own flags. */
function FieldRow({ field, value }: { field: TemplateField; value: string }) {
  return (
    <>
      <dt style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{field.label}</dt>
      <dd style={{ margin: 0, fontSize: '0.92rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {field.sensitive ? (
          <>
            <SensitiveField value={value} label={field.label} multiline={field.type === 'multiline'} />
            <CopyButton value={value} label={field.label} />
          </>
        ) : (
          <>
            <span style={{ overflowWrap: 'anywhere' }}>{value}</span>
            <CopyButton value={value} label={field.label} />
          </>
        )}
      </dd>
    </>
  );
}

const card: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '0.75rem 0.85rem',
  marginBottom: '0.65rem',
};

const miniButton: React.CSSProperties = {
  padding: '0.25rem 0.6rem',
  fontSize: '0.85rem',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg)',
  cursor: 'pointer',
};

const select: React.CSSProperties = {
  padding: '0.2rem 0.35rem',
  fontSize: '0.85rem',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--bg)',
  color: 'var(--fg)',
};
