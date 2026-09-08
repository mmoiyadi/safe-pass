/**
 * The list column: one line per secret (T035, T036, T038, T044, T045 — FR-014).
 *
 * The change this component exists for: a row used to render every field of every secret, plus a
 * folder dropdown and a button per tag, so two dozen secrets were thousands of pixels of
 * scrolling and nothing could be scanned. A row is now a title and one summary line; everything
 * else moved to the detail pane beside it.
 *
 * No sensitive value appears here, revealed or masked (FR-014). The one value the summary carries
 * is non-sensitive by construction, and where a secret has none the part is omitted rather than
 * filled with a placeholder (FR-014a).
 */
import type { TemplateVersionRecord } from '@pm/shared';
import { Plus } from 'lucide-react';
import type { SearchHit } from '../../search/index.js';
import { CopyButton } from '../../components/CopyButton.js';
import { Icon } from '../../components/Icon.js';
import { SearchBar } from '../search/SearchBar.js';
import type { DecryptedSecret } from './decrypted-secret.js';
import { avatarInitial, firstSensitiveField, summaryValue } from './secret-summary.js';
import { templateTint } from './template-tint.js';

export interface SecretListColumnProps {
  items: DecryptedSecret[];
  hits: Map<string, SearchHit> | null;
  templates: Map<string, TemplateVersionRecord>;
  folderName: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewSecret: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  totalCount: number;
  offline: boolean;
  loading: boolean;
}

export function SecretListColumn({
  items,
  hits,
  templates,
  folderName,
  selectedId,
  onSelect,
  onNewSecret,
  query,
  onQueryChange,
  totalCount,
  offline,
  loading,
}: SecretListColumnProps) {
  const countText =
    hits === null
      ? `${totalCount} secret${totalCount === 1 ? '' : 's'}`
      : `${items.length} of ${totalCount} match`;

  return (
    <div className="list-column" style={column}>
      <SearchBar onQueryChange={onQueryChange} />

      {/*
        One left-aligned line. The sort control the handoff drew on the right is not here:
        sorting is out of scope, and the handoff's own instruction is to drop the control
        rather than leave it inert (FR-014d).

        The suffix is the short form of the search privacy line; the full sentence keeps its
        exact wording in the Offline access settings panel (FR-002a).
      */}
      <p style={countLine}>{countText} · searched on this device</p>

      {loading ? (
        /* Replaces the rows only. Search, the count line and the create action stay put, and
           the detail pane is untouched (FR-014e). */
        <p style={muted}>Decrypting…</p>
      ) : (
        <ul style={list}>
          {items.map((item) => (
            <Row
              key={item.id}
              secret={item}
              template={templates.get(item.templateVersionId)}
              folderName={item.folderId ? (folderName.get(item.folderId) ?? null) : null}
              hit={hits?.get(item.id) ?? null}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          ))}

          {items.length === 0 && totalCount > 0 && (
            <li style={muted}>
              Nothing matches. {query && <>Try a shorter search, or </>}clear the filters.
            </li>
          )}
          {totalCount === 0 && <li style={muted}>Nothing stored yet.</li>}
        </ul>
      )}

      {offline ? (
        <p style={muted}>
          Adding and editing need a connection. Reconnect to make changes — nothing you do here
          is queued, so nothing will be applied later without you seeing it.
        </p>
      ) : (
        /* One action, which then offers the type choice — replacing the row of one button per
           template that used to sit at the page foot (FR-018). */
        <button type="button" onClick={onNewSecret} style={newSecret}>
          <Icon icon={Plus} size={16} />
          New secret
        </button>
      )}
    </div>
  );
}

function Row({
  secret,
  template,
  folderName,
  hit,
  selected,
  onSelect,
}: {
  secret: DecryptedSecret;
  template: TemplateVersionRecord | undefined;
  folderName: string | null;
  hit: SearchHit | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const tint = templateTint(template?.name ?? '');
  const value = summaryValue(secret, template);
  const sensitive = firstSensitiveField(secret, template);

  /*
   * `template.name · folderName · value`, with any part that has nothing to say dropped along
   * with its separator. Joining a filtered list rather than concatenating conditionals is what
   * stops a stray "·" appearing at either end (FR-014a).
   */
  const summary = [
    template?.name ?? 'Unknown type',
    folderName,
    value,
    hit && hit.matchedIn !== 'title' ? `matched in ${hit.matchedIn}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <li className="secret-row" style={selected ? rowSelected : row}>
      {/*
        The row is a native button and its own tab stop; the quick-copy control below is a
        second stop within the row (FR-026a). They are siblings rather than nested, because a
        button inside a button is not valid HTML and browsers do not honour it.
      */}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        data-secret-id={secret.id}
        style={rowButton}
      >
        <span
          className="secret-avatar"
          style={{ ...avatar, background: tint.background, color: tint.foreground }}
          aria-hidden
        >
          {avatarInitial(secret.title)}
        </span>
        <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <span style={title}>{secret.title}</span>
          <span style={summaryLine}>{summary}</span>
        </span>
      </button>

      {/* Absent entirely when there is nothing sensitive to copy — never disabled (FR-014b). */}
      {sensitive && <CopyButton value={sensitive.value} label={sensitive.label} />}
    </li>
  );
}

/* ---------------------------------------------------------------- styles */

const column: React.CSSProperties = {
  width: 352,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minHeight: 0,
};

const countLine: React.CSSProperties = {
  margin: 0,
  padding: '0 8px',
  fontSize: 12.5,
  color: 'var(--color-neutral-700)',
};

const list: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  overflowY: 'auto',
  minHeight: 0,
  flex: 1,
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  paddingRight: 8,
  borderRadius: 20,
};

const rowSelected: React.CSSProperties = {
  ...row,
  background: 'var(--color-neutral-100)',
  boxShadow: 'var(--shadow-sm)',
};

const rowButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flex: 1,
  minWidth: 0,
  minHeight: 44,
  padding: '10px 14px',
  border: 'none',
  borderRadius: 20,
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  cursor: 'pointer',
};

const avatar: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  flexShrink: 0,
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 700,
};

/** Title and summary truncate independently, each on its own line (FR-014c). */
const title: React.CSSProperties = {
  display: 'block',
  fontSize: 14.5,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const summaryLine: React.CSSProperties = {
  display: 'block',
  fontSize: 12.5,
  color: 'var(--color-neutral-700)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const muted: React.CSSProperties = {
  margin: 0,
  padding: '4px 8px',
  fontSize: 13,
  color: 'var(--color-neutral-700)',
};

const newSecret: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: '100%',
  minHeight: 44,
  padding: 13,
  border: 'none',
  borderRadius: 999,
  // White on `--color-accent` is 3.61:1 at this size; the deeper step clears 4.5:1
  // (spec.md → Decisions taken → Contrast).
  background: 'var(--color-accent-700)',
  color: '#fff',
  fontFamily: 'var(--font-heading)',
  fontSize: 15,
  cursor: 'pointer',
};
