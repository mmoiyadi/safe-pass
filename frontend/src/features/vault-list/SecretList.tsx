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
import { TemplateForm, type TemplateFormValues } from '../templates/TemplateForm.js';
import { DeleteDialog } from '../secret-detail/DeleteDialog.js';
import {
  CUSTOM_FIELDS_KEY,
  decodeCustomFields,
  encodeCustomFields,
} from '../secret-detail/CustomFields.js';
import { SecretDetail } from '../secret-detail/SecretDetail.js';
import type { CachedVault } from '../../vault/offline-cache.js';
import { UNFILED, type FilterState, type NamedItem } from './Filters.js';
import { SecretListColumn } from './SecretListColumn.js';
import type { DecryptedSecret } from './decrypted-secret.js';
import type { VaultWithName } from './vault-name.js';

export function SecretList({
  vaultId,
  templates,
  vault,
  cached,
  filters,
  onDataChanged,
}: {
  vaultId: string;
  templates: TemplateVersionRecord[];
  /** Needed for the detail footer, which says "Only you" for a personal vault (FR-030c). */
  vault: VaultWithName | undefined;
  /** Owned by `App` and edited from the rail; this component only applies it (T021a). */
  filters: FilterState;
  /**
   * The device's encrypted copy, supplied when this session was opened with no network. When
   * present it is the ONLY source: the server is not reachable, so asking it would just fail
   * and leave the user staring at an empty vault they know is not empty (FR-054).
   */
  cached?: CachedVault | undefined;
  onDataChanged?: (next: {
    folders: NamedItem[];
    tags: NamedItem[];
    folderCounts: Map<string, number>;
    tagCounts: Map<string, number>;
    unfiled: number;
    total: number;
  }) => void;
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
  /**
   * Which row the detail pane is showing. Only the ID is stored — see `selected` below.
   */
  const [selectedSecretId, setSelectedSecretId] = useState<string | null>(null);
  /** True while the type choice is on screen, between "New secret" and a template being picked. */
  const [choosing, setChoosing] = useState(false);

  /**
   * Older template versions fetched on demand. The templates prop carries current versions
   * only, so a secret written before its template changed has nothing to render from until
   * its version is resolved (FR-040).
   */
  const [olderVersions, setOlderVersions] = useState<TemplateVersionRecord[]>([]);

  const byId = useMemo(
    () => new Map([...templates, ...olderVersions].map((t) => [t.id, t] as const)),
    [templates, olderVersions],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, folderRows, tagRows] = cached
        ? [
            cached.secrets as unknown as SecretRecord[],
            cached.folders as Array<{ id: string; name: string; keyVersion: number }>,
            cached.tags as Array<{ id: string; name: string; keyVersion: number }>,
          ]
        : await Promise.all([
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

        // The custom-field blob is one reserved entry, not a template field. Lift it out so
        // nothing downstream mistakes it for a value to render.
        const custom = decodeCustomFields(fields[CUSTOM_FIELDS_KEY]);
        delete fields[CUSTOM_FIELDS_KEY];

        out.push({
          custom,
          id: row.id,
          title: await decrypt(key, row.title),
          templateVersionId: row.templateVersionId,
          revision: row.revision,
          keyVersion: row.keyVersion,
          folderId: row.folderId,
          tagIds: row.tagIds,
          fields,
          updatedAt: row.updatedAt,
        });
      }

      setItems(out);
      setFolders(decryptedFolders);
      setTags(decryptedTags);
      setError(null);

      // Resolve any template version these secrets use that the current list does not carry.
      // A failure here is not fatal: the secret still shows its title and can be deleted.
      const known = new Set(templates.map((t) => t.id));
      const missing = [...new Set(out.map((s) => s.templateVersionId))].filter((id) => !known.has(id));
      if (missing.length > 0 && !cached) {
        const resolved = await Promise.all(
          missing.map((id) =>
            api<TemplateVersionRecord>('GET', `/templates/versions/${id}`).catch(() => null),
          ),
        );
        setOlderVersions(resolved.filter((v): v is TemplateVersionRecord => v !== null));
      } else {
        setOlderVersions([]);
      }
    } catch {
      setError(
        cached
          ? 'Could not open the copy stored on this device.'
          : 'Could not load this vault.',
      );
    } finally {
      setLoading(false);
    }
  }, [vaultId, templates, cached]);

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
        // Custom fields are fields: a non-sensitive one is as searchable as any other (FR-044).
        // Sensitive ones stay out of the index, exactly like a template's sensitive fields.
        for (const field of item.custom) {
          if (!field.sensitive && field.value) searchable[field.id] = field.value;
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

  const unfiled = useMemo(() => items.filter((i) => i.folderId === null).length, [items]);

  useEffect(() => {
    onDataChanged?.({
      folders,
      tags,
      folderCounts,
      tagCounts,
      unfiled,
      total: items.length,
    });
  }, [folders, tags, folderCounts, tagCounts, unfiled, items.length, onDataChanged]);

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

  /**
   * Derived, not merely stored (T034, FR-017).
   *
   * Looking the secret up in the VISIBLE list each render is what makes the rule hold for free:
   * a secret filtered away, searched away, or deleted cannot leave the detail pane showing
   * something that is no longer there, because there is nothing to find. Storing the object
   * instead would need every one of those paths to remember to clear it.
   */
  const selected = visible.find((item) => item.id === selectedSecretId) ?? null;

  async function encryptValues(template: TemplateVersionRecord, values: TemplateFormValues) {
    const { key, keyVersion } = writeKeyFor(vaultId);
    const fieldValues: Record<string, string> = {};
    for (const field of template.fields as TemplateField[]) {
      // Every value is encrypted, sensitive or not. `sensitive` drives masking, not encryption.
      fieldValues[field.id] = await encrypt<SecretFieldValue>(key, values.fields[field.id] ?? '');
    }

    // Labels included: the whole set goes in as one envelope so the server never sees what the
    // user called these fields (CustomFields.tsx).
    const packed = encodeCustomFields(values.custom);
    if (packed !== null) {
      fieldValues[CUSTOM_FIELDS_KEY] = await encrypt<SecretFieldValue>(key, packed);
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
      custom: secret.custom,
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

  const offline = Boolean(cached);
  const editingTemplate = editing ? byId.get(editing.templateVersionId) : undefined;

  /*
   * Focus follows the level change, but only in the stacked layout (FR-026b).
   *
   * Side by side, activating a row leaves focus on it and Tab reaches the pane, which is what a
   * pointer user expects. Stacked, the list is not on screen at all any more — leaving focus on
   * a row nobody can see strands a keyboard user on an invisible element, so focus moves into
   * the detail and the back control returns it to the row it came from.
   */
  const stacked = () =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches;

  function selectSecret(id: string) {
    setSelectedSecretId(id);
    if (!stacked()) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.detail-back')?.focus());
  }

  function backToList() {
    const previous = selectedSecretId;
    setSelectedSecretId(null);
    if (!stacked() || !previous) return;
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-secret-id="${previous}"]`)?.focus(),
    );
  }

  return (
    <div className="vault-panes" data-detail-open={selected ? 'true' : 'false'}>
      <SecretListColumn
        items={visible}
        hits={hits}
        templates={byId}
        folderName={folderName}
        selectedId={selectedSecretId}
        onSelect={selectSecret}
        onNewSecret={() => {
          // Creating clears the selection; Cancel returns to the prompt (FR-016b).
          setSelectedSecretId(null);
          setEditing(null);
          setChoosing(true);
        }}
        query={query}
        onQueryChange={setQuery}
        totalCount={items.length}
        offline={offline}
        loading={loading}
      />

      {/*
        The detail pane shows exactly one of four things: the type choice, a form, the selected
        secret, or the prompt. Forms render HERE rather than in a dialog, so the list stays
        visible and Cancel returns to what was on screen before (FR-016a).
      */}
      {choosing ? (
        <div className="pane" style={formPane}>
          <h3 style={{ margin: '0 0 14px' }}>New secret</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setChoosing(false);
                  setAdding(t);
                }}
                style={choicePill}
              >
                {t.name}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setChoosing(false)} style={cancelLink}>
            Cancel
          </button>
        </div>
      ) : adding ? (
        <div className="pane" style={formPane}>
          <h3 style={{ margin: '0 0 14px' }}>New {adding.name}</h3>
          {error && <p style={conflict}>{error}</p>}
          <TemplateForm
            template={adding}
            filing={{ folders, tags }}
            onSubmit={(v) => create(adding, v)}
            onCancel={() => setAdding(null)}
          />
        </div>
      ) : editing && editingTemplate ? (
        <div className="pane" style={formPane}>
          <h3 style={{ margin: '0 0 14px' }}>Edit “{editing.title}”</h3>
          {/*
            The refusal of a conflicting save, verbatim and above the form, with what was typed
            still in the fields (FR-011, FR-016c).
          */}
          {error && <p style={conflict}>{error}</p>}
          <TemplateForm
            template={editingTemplate}
            initial={{
              title: editing.title,
              fields: editing.fields,
              custom: editing.custom,
              folderId: editing.folderId,
              tagIds: editing.tagIds,
            }}
            filing={{ folders, tags }}
            submitLabel="Save changes"
            onSubmit={(v) => update(editing, v)}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        <SecretDetail
          onBack={backToList}
          secret={selected}
          template={selected ? byId.get(selected.templateVersionId) : undefined}
          vault={vault}
          folders={folders}
          tags={tags}
          onEdit={() => selected && setEditing(selected)}
          onDelete={() => selected && setDeleting(selected)}
          onFile={async (folderId) => {
            if (selected) await file(selected, folderId);
          }}
          onToggleTag={async (tagId) => {
            if (selected) await toggleTag(selected, tagId);
          }}
          offline={offline}
        />
      )}

      {deleting && (
        <DeleteDialog
          title={deleting.title}
          shared={vault ? vault.kind !== 'personal' : false}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await api('DELETE', `/vaults/${vaultId}/secrets/${deleting.id}`);
            setDeleting(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

const formPane: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '30px 32px',
  borderRadius: 28,
  background: 'var(--color-neutral-100)',
  overflowY: 'auto',
};

const conflict: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: 13.5,
  color: 'var(--color-accent-700)',
};

const choicePill: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: 999,
  border: '1px solid var(--color-neutral-300)',
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
};

const cancelLink: React.CSSProperties = {
  marginTop: 16,
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'var(--color-accent-700)',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'underline',
  cursor: 'pointer',
};
