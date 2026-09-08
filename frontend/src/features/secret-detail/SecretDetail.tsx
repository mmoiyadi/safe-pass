/**
 * The detail pane (T039-T044 — FR-015, FR-016, FR-030c).
 *
 * Everything a row used to carry inline lives here: fields, custom fields, filing and tagging.
 * That is what lets the list beside it be one line per secret.
 *
 * Two chip vocabularies appear in this application and they must not be confused (FR-022b). The
 * chips in this header are labels — what this secret is, where it is filed, what it carries. The
 * chips in the rail are filter controls with an on/off state. The ones here are not focusable and
 * do not announce themselves as controls; the filing section below is where tagging is done.
 */
import type { TemplateField, TemplateVersionRecord } from '@pm/shared';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { CopyButton } from '../../components/CopyButton.js';
import { Icon } from '../../components/Icon.js';
import { SensitiveField } from '../../components/SensitiveField.js';
import type { NamedItem } from '../vault-list/Filters.js';
import type { DecryptedSecret } from '../vault-list/decrypted-secret.js';
import type { VaultWithName } from '../vault-list/vault-name.js';
import { CustomFieldList } from './CustomFields.js';
import { relativeUpdated } from './relative-time.js';

export interface SecretDetailProps {
  /** Returns to the list in the stacked layout, where the two are not side by side. */
  onBack: () => void;
  secret: DecryptedSecret | null;
  template: TemplateVersionRecord | undefined;
  vault: VaultWithName | undefined;
  folders: NamedItem[];
  tags: NamedItem[];
  onEdit: () => void;
  onDelete: () => void;
  onFile: (folderId: string | null) => Promise<void>;
  onToggleTag: (tagId: string) => Promise<void>;
  offline: boolean;
}

export function SecretDetail({
  onBack,
  secret,
  template,
  vault,
  folders,
  tags,
  onEdit,
  onDelete,
  onFile,
  onToggleTag,
  offline,
}: SecretDetailProps) {
  // A prompt, not an empty box: an empty pane reads as something failing to load (FR-016).
  if (!secret) {
    return (
      <div className="detail-pane pane" style={pane}>
        <p style={{ margin: 0, color: 'var(--color-neutral-700)', fontSize: 13.5 }}>
          Choose a secret to see its fields.
        </p>
      </div>
    );
  }

  const fields = [...((template?.fields ?? []) as TemplateField[])]
    .sort((a, b) => a.order - b.order)
    .filter((field) => (secret.fields[field.id] ?? '').length > 0);

  const folder = secret.folderId ? folders.find((f) => f.id === secret.folderId) : undefined;

  return (
    <div className="detail-pane pane" style={pane}>
      {/*
        Below the breakpoint the detail takes over the screen, so there has to be a way back
        (FR-020a). Above it the list is already beside this pane and the control would be
        meaningless, so CSS hides it there rather than JS rendering two different panes.
      */}
      <button type="button" onClick={onBack} className="detail-back" style={backRow}>
        <Icon icon={ArrowLeft} size={16} />
        Back to the list
      </button>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <span style={typeChip}>{template?.name ?? 'Unknown type'}</span>
        {folder && <span style={folderChip}>{folder.name}</span>}
        {tags
          .filter((tag) => secret.tagIds.includes(tag.id))
          .map((tag) => (
            <span key={tag.id} style={tagChip}>
              {tag.name}
            </span>
          ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <h3 style={{ flex: 1, margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{secret.title}</h3>
        {/* Editing and deleting need a connection, so both are absent offline (FR-007). */}
        {!offline && (
          <div style={{ display: 'flex', gap: 4 }}>
            {/* "Edit", not "Edit secret": FR-025 requires an icon-only control to keep the
                accessible name the text button already had, verbatim. */}
            <button type="button" onClick={onEdit} className="icon-button" aria-label="Edit">
              <Icon icon={Pencil} size={15} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="icon-button"
              aria-label="Delete"
              style={{ color: 'var(--color-accent-700)' }}
            >
              <Icon icon={Trash2} size={15} />
            </button>
          </div>
        )}
      </div>

      <dl style={grid}>
        {fields.map((field) => (
          <FieldRow key={field.id} field={field} value={secret.fields[field.id] ?? ''} />
        ))}
      </dl>

      {secret.custom.length > 0 && (
        <>
          <h4 style={sectionHeading}>Your own fields</h4>
          <CustomFieldList fields={secret.custom} />
        </>
      )}

      {/* The only place filing and tagging are offered (FR-015). */}
      {!offline && (folders.length > 0 || tags.length > 0) && (
        <div style={filing}>
          {folders.length > 0 && (
            <label style={{ fontSize: 12.5, color: 'var(--color-neutral-700)' }}>
              Folder{' '}
              <select
                value={secret.folderId ?? ''}
                onChange={(e) => void onFile(e.target.value || null)}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map((tag) => {
              const on = secret.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => void onToggleTag(tag.id)}
                  aria-pressed={on}
                  style={on ? tagToggleOn : tagToggle}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p style={footer}>
        <span>
          Revision {secret.revision} · encrypted under key v{secret.keyVersion}
          {relativeUpdated(secret.updatedAt) && ` · ${relativeUpdated(secret.updatedAt)}`}
        </span>
        {/*
          "Only you" is derivable for a personal vault. For a shared one there is NOTHING here:
          the member count the handoff asked for is not available where this pane can reach it,
          and inventing a number would be worse than omitting the line (FR-030c).
        */}
        {vault?.kind === 'personal' && <span>Only you</span>}
      </p>
    </div>
  );
}

/** One field row. Masking and copy availability both follow the field's own flags. */
function FieldRow({ field, value }: { field: TemplateField; value: string }) {
  return (
    <>
      <dt style={{ color: 'var(--color-neutral-700)', fontSize: 12.5 }}>{field.label}</dt>
      <dd style={dd}>
        {field.sensitive ? (
          <SensitiveField value={value} label={field.label} multiline={field.type === 'multiline'} />
        ) : (
          <span style={{ overflowWrap: 'anywhere', flex: 1 }}>{value}</span>
        )}
        <CopyButton value={value} label={field.label} />
      </dd>
    </>
  );
}

/* ---------------------------------------------------------------- styles */

const pane: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '30px 32px',
  borderRadius: 28,
  background: 'var(--color-neutral-100)',
  overflowY: 'auto',
};

const backRow: React.CSSProperties = {
  alignItems: 'center',
  gap: 8,
  minHeight: 44,
  marginBottom: 6,
  padding: '6px 4px',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
};

const chip: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
};

const typeChip: React.CSSProperties = {
  ...chip,
  background: 'var(--color-accent-200)',
  color: 'var(--color-accent-700)',
};

const folderChip: React.CSSProperties = {
  ...chip,
  background: 'var(--color-accent-2-200)',
  color: 'var(--color-accent-2-800)',
};

/** Outline and non-interactive — a label, not a control (FR-022b). */
const tagChip: React.CSSProperties = {
  ...chip,
  fontWeight: 600,
  background: 'transparent',
  border: '1px solid var(--color-neutral-300)',
  color: 'var(--color-neutral-700)',
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '132px minmax(0, 1fr)',
  alignItems: 'center',
  gap: '4px 16px',
  margin: '18px 0 0',
};

const dd: React.CSSProperties = {
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 14,
  minWidth: 0,
};

const sectionHeading: React.CSSProperties = {
  margin: '22px 0 0',
  fontSize: 11.5,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontWeight: 700,
  fontFamily: 'var(--font-body)',
  color: 'var(--color-neutral-700)',
};

const filing: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  marginTop: 22,
  paddingTop: 16,
  borderTop: '1px solid var(--color-divider)',
};

const select: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: 999,
  border: '1px solid var(--color-neutral-300)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 13,
};

const tagToggle: React.CSSProperties = {
  padding: '5px 11px',
  borderRadius: 999,
  border: '1px solid var(--color-neutral-300)',
  background: 'transparent',
  color: 'var(--color-neutral-700)',
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};

const tagToggleOn: React.CSSProperties = {
  ...tagToggle,
  border: '1px solid transparent',
  background: 'var(--color-accent-700)',
  color: '#fff',
};

const footer: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  margin: '26px 0 0',
  paddingTop: 14,
  borderTop: '1px solid var(--color-divider)',
  fontSize: 12,
  color: 'var(--color-neutral-700)',
};
