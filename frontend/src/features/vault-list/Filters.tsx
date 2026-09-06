/**
 * Folder and tag filters (T072, FR-047).
 *
 * Folders are exclusive — a secret sits in one folder or none. Tags are additive, and multiple
 * selected tags narrow (AND) rather than widen: picking two tags should show the secrets
 * carrying both, which is what "filter" means to someone using it.
 */
export interface NamedItem {
  id: string;
  name: string;
}

export interface FilterState {
  folderId: string | null;
  /** null means "any folder"; UNFILED means "no folder". */
  tagIds: string[];
}

export const UNFILED = '__unfiled__';

export function Filters({
  folders,
  tags,
  state,
  counts,
  onChange,
}: {
  folders: NamedItem[];
  tags: NamedItem[];
  state: FilterState;
  counts: { byFolder: Map<string, number>; byTag: Map<string, number>; unfiled: number };
  onChange: (next: FilterState) => void;
}) {
  if (folders.length === 0 && tags.length === 0) return null;

  const active = state.folderId !== null || state.tagIds.length > 0;

  return (
    <div style={{ marginBottom: '0.9rem' }}>
      {folders.length > 0 && (
        <Row label="Folder">
          <Chip
            active={state.folderId === null}
            onClick={() => onChange({ ...state, folderId: null })}
            label="Any"
          />
          {folders.map((folder) => (
            <Chip
              key={folder.id}
              active={state.folderId === folder.id}
              onClick={() =>
                onChange({ ...state, folderId: state.folderId === folder.id ? null : folder.id })
              }
              label={folder.name}
              count={counts.byFolder.get(folder.id) ?? 0}
            />
          ))}
          {counts.unfiled > 0 && (
            <Chip
              active={state.folderId === UNFILED}
              onClick={() =>
                onChange({ ...state, folderId: state.folderId === UNFILED ? null : UNFILED })
              }
              label="Unfiled"
              count={counts.unfiled}
            />
          )}
        </Row>
      )}

      {tags.length > 0 && (
        <Row label="Tags">
          {tags.map((tag) => {
            const on = state.tagIds.includes(tag.id);
            return (
              <Chip
                key={tag.id}
                active={on}
                onClick={() =>
                  onChange({
                    ...state,
                    tagIds: on ? state.tagIds.filter((t) => t !== tag.id) : [...state.tagIds, tag.id],
                  })
                }
                label={tag.name}
                count={counts.byTag.get(tag.id) ?? 0}
              />
            );
          })}
        </Row>
      )}

      {active && (
        <button
          type="button"
          onClick={() => onChange({ folderId: null, tagIds: [] })}
          style={{
            marginTop: '0.35rem',
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--accent)',
            textDecoration: 'underline',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: '0.85rem',
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
      <span style={{ color: 'var(--muted)', fontSize: '0.85rem', minWidth: '3.2rem' }}>{label}</span>
      {children}
    </div>
  );
}

function Chip({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '0.2rem 0.55rem',
        fontSize: '0.85rem',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--fg)',
        cursor: 'pointer',
      }}
    >
      {label}
      {count !== undefined && (
        <span style={{ opacity: 0.7, marginLeft: '0.35rem' }}>{count}</span>
      )}
    </button>
  );
}
