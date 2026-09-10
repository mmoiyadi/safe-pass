/**
 * The permanent left rail (T020-T022, T027, FR-013).
 *
 * Replaces four stacked strips — the account bar, `VaultSwitcher`, the vault tabs and `Filters` —
 * with one column that is always visible. The point is not density: it is that the list no longer
 * starts a third of the way down the page, and that a vault switch no longer reflows everything
 * below it.
 *
 * This component owns no filter state. It renders the `FilterState` it is given and reports
 * changes upward (`onFiltersChange`), because the same state drives the list beside it — two
 * copies would drift. It fetches nothing except when creating a vault, which is a write the old
 * `VaultSwitcher` owned and which comes across unchanged.
 *
 * Sections with nothing to list are omitted entirely, heading included (FR-013a): an empty
 * "Folders" heading is furniture that tells the user nothing.
 */
import { useState, type FormEvent } from 'react';
import {
  FolderIcon,
  Inbox,
  KeyRound,
  Lock as LockIcon,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  User,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { VaultName } from '@pm/shared';
import { api } from '../../api/client.js';
import { encrypt } from '../../crypto/envelope.js';
import { generateVaultKey, wrapVaultKeyForMember } from '../../crypto/vault-key.js';
import { importPublicKey } from '../../crypto/user-key.js';
import { getKeyring } from '../../vault/session.js';
import { Icon } from '../../components/Icon.js';
import { Mark } from '../../components/Mark.js';
import { UNFILED, type FilterState, type NamedItem } from '../vault-list/Filters.js';
import type { VaultWithName } from '../vault-list/vault-name.js';
import { LockCountdown } from './LockCountdown.js';
import type { Screen } from './screen.js';

export interface VaultRailProps {
  screen: Screen;
  vaults: VaultWithName[];
  selectedVaultId: string;
  onSelectVault: (id: string) => void;
  onVaultCreated: () => Promise<void>;

  onNavigate: (screen: Screen) => void;

  folders: NamedItem[];
  tags: NamedItem[];
  counts: { byFolder: Map<string, number>; byTag: Map<string, number>; unfiled: number };
  total: number;
  filters: FilterState;
  onFiltersChange: (next: FilterState) => void;

  email: string;
  onLock: () => void;
  offline: boolean;
}

export function VaultRail({
  screen,
  vaults,
  selectedVaultId,
  onSelectVault,
  onVaultCreated,
  onNavigate,
  folders,
  tags,
  counts,
  total,
  filters,
  onFiltersChange,
  email,
  onLock,
  offline,
}: VaultRailProps) {
  const filtersActive = filters.folderId !== null || filters.tagIds.length > 0;

  return (
    <nav aria-label="Vault navigation" className="rail" style={rail}>
      <Brand />

      <VaultSection
        vaults={vaults}
        selectedVaultId={selectedVaultId}
        onSelectVault={onSelectVault}
        onVaultCreated={onVaultCreated}
        offline={offline}
      />

      <section aria-label="Scope" style={group}>
        <ScopeRow
          icon={KeyRound}
          label="All secrets"
          count={total}
          selected={filters.folderId === null && filters.tagIds.length === 0}
          onClick={() => onFiltersChange({ folderId: null, tagIds: [] })}
        />
        <ScopeRow
          icon={Inbox}
          label="Unfiled"
          count={counts.unfiled}
          selected={filters.folderId === UNFILED}
          onClick={() =>
            onFiltersChange({
              ...filters,
              folderId: filters.folderId === UNFILED ? null : UNFILED,
            })
          }
        />
      </section>

      {/*
        The two vault screens the old tab strip carried (FR-013b).
        
        Unconditional, deliberately. The handoff reaches Organise through a "Manage" link inside
        the Folders section — which is absent exactly when it is needed most, because a vault with
        no folders yet renders no Folders section (FR-013a). A new account could never create its
        first folder. Sharing had no rail entry at all and existed only in the phone layout's
        bottom bar, so above the breakpoint it was simply gone. Both are capabilities that existed
        before the redesign, and FR-001 does not allow losing either.
      */}
      <section aria-label="Vault screens" style={group}>
        <NavRow
          icon={FolderIcon}
          label="Folders & tags"
          selected={screen === 'organise'}
          onClick={() => onNavigate('organise')}
        />
        <NavRow
          icon={Users}
          label="Sharing"
          selected={screen === 'sharing'}
          onClick={() => onNavigate('sharing')}
        />
      </section>

      {/* FR-013a: no folders means no heading either. */}
      {folders.length > 0 && (
        <section aria-label="Folders" style={group}>
          <span style={sectionLabel}>Folders</span>
          {folders.map((folder) => (
            <ScopeRow
              key={folder.id}
              icon={FolderIcon}
              label={folder.name}
              count={counts.byFolder.get(folder.id) ?? 0}
              selected={filters.folderId === folder.id}
              // Folder selection stays exclusive: choosing one deselects any other (FR-006).
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  folderId: filters.folderId === folder.id ? null : folder.id,
                })
              }
              small
            />
          ))}
        </section>
      )}

      {tags.length > 0 && (
        <section aria-label="Tags" style={group}>
          <span style={sectionLabel}>
            Tags{' '}
            <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>
              — narrow together
            </span>
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {tags.map((tag) => {
              const on = filters.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  // Tags are cumulative: a secret must carry every selected tag (FR-006).
                  onClick={() =>
                    onFiltersChange({
                      ...filters,
                      tagIds: on
                        ? filters.tagIds.filter((t) => t !== tag.id)
                        : [...filters.tagIds, tag.id],
                    })
                  }
                  style={on ? tagChipOn : tagChip}
                >
                  {tag.name}
                  <span style={{ opacity: 0.6, marginLeft: 5 }}>{counts.byTag.get(tag.id) ?? 0}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* FR-006a: offered only while something is actually filtered. */}
      {filtersActive && (
        <button
          type="button"
          onClick={() => onFiltersChange({ folderId: null, tagIds: [] })}
          style={clearFilters}
        >
          Clear filters
        </button>
      )}

      <div className="rail-footer" style={footer}>
        <LockCountdown />

        <span style={accountPill}>
          <span style={avatar} aria-hidden>
            {email.slice(0, 1).toUpperCase()}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {email}
          </span>
        </span>

        <div style={{ display: 'flex', gap: 6 }}>
          {/* Settings gets its own rail with its own back row, so this is a one-way trip. */}
          <button type="button" onClick={() => onNavigate('settings')} style={settingsPill}>
            <Icon icon={SettingsIcon} size={15} />
            Settings
          </button>
          <button type="button" onClick={onLock} style={lockPill}>
            <Icon icon={LockIcon} size={15} />
            Lock
          </button>
        </div>
      </div>
    </nav>
  );
}

function Brand() {
  return (
    <div className="rail-brand" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px' }}>
      <span style={brandMark}>
        <Mark size={20} />
      </span>
      {/*
        The only place in the interface that uses the icon form (FR-010). Everywhere else — the
        unlock screen, mail, the backup file — the word alone is enough.

        This supersedes FR-022a of the vault workbench redesign, which required the rail to read
        "Password Manager" on the grounds that naming a product is not a visual decision. Naming
        it is the whole point of this feature.
      */}
      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 19, letterSpacing: '-0.01em' }}>
        Cairn
      </span>
    </div>
  );
}

function VaultSection({
  vaults,
  selectedVaultId,
  onSelectVault,
  onVaultCreated,
  offline,
}: Pick<VaultRailProps, 'vaults' | 'selectedVaultId' | 'onSelectVault' | 'onVaultCreated' | 'offline'>) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Unchanged from `VaultSwitcher`: a fresh key per vault, wrapped to the creator's own public
   * key, so the server receives two things it cannot open. Moved, not rewritten — this is the
   * one write the rail owns.
   */
  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const keyring = getKeyring();
      if (!keyring) throw new Error('Sign in again to create a vault.');

      const vaultKey = generateVaultKey();
      await api('POST', '/vaults', {
        name: await encrypt<VaultName>(vaultKey, name.trim()),
        wrappedVaultKey: await wrapVaultKeyForMember(
          await importPublicKey(keyring.publicKey),
          vaultKey,
        ),
      });

      setName('');
      setCreating(false);
      await onVaultCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the vault.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Vault" style={group}>
      <span style={sectionLabel}>Vault</span>
      {vaults.map((vault) => {
        const selected = vault.id === selectedVaultId;
        return (
          <button
            key={vault.id}
            type="button"
            onClick={() => onSelectVault(vault.id)}
            aria-current={selected ? 'true' : undefined}
            style={selected ? vaultRowSelected : vaultRow}
          >
            <span title={vault.kind === 'personal' ? 'Private to you' : undefined}>
              <Icon icon={vault.kind === 'personal' ? User : Users} size={16} />
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
              {vault.decryptedName}
            </span>
            {/* Marker only — never a percentage, which exists only inside the sharing
                screen while that screen is driving a rotation (FR-030b). */}
            {vault.rotationPending && (
              <span style={rotationChip} title="Re-encrypting after a revocation">
                <Icon icon={RefreshCw} size={11} />
              </span>
            )}
          </button>
        );
      })}

      {/* Creating a vault needs the network, so it is absent offline (FR-007). */}
      {!offline && !creating && (
        <button type="button" onClick={() => setCreating(true)} style={newVaultRow}>
          <Icon icon={Plus} size={15} />
          New vault
        </button>
      )}

      {creating && (
        <form onSubmit={create} style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vault name"
            aria-label="Vault name"
            autoFocus
            autoComplete="off"
            style={pillInput}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" disabled={busy || !name.trim()} style={{ ...settingsPill, flex: 1 }}>
              Create
            </button>
            <button type="button" onClick={() => setCreating(false)} style={{ ...settingsPill, flex: 1 }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p style={{ color: 'var(--color-accent-700)', fontSize: 12.5, margin: '6px 0 0' }}>{error}</p>}
    </section>
  );
}

function NavRow({
  icon,
  label,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      style={selected ? vaultRowSelected : vaultRow}
    >
      <Icon icon={icon} size={16} />
      <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
    </button>
  );
}

function ScopeRow({
  icon,
  label,
  count,
  selected,
  onClick,
  small = false,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      style={{
        ...(selected ? vaultRowSelected : vaultRow),
        fontSize: small ? 13.5 : 14,
        padding: small ? '8px 12px' : '9px 12px',
      }}
    >
      <Icon icon={icon} size={small ? 15 : 16} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
        {label}
      </span>
      {/* 12.5px, not the handoff's 12px: this sits inside a control, and the measured floor
          for interactive text is 12.5px (FR-029, T067a). Half a pixel, and it is checked. */}
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-neutral-700)' }}>
        {count}
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------- styles */

const rail: React.CSSProperties = {
  width: 262,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: '22px 16px',
  background: 'var(--color-surface)',
  borderRadius: 28,
  overflowY: 'auto',
};

const group: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3 };

/**
 * `--color-neutral-700`, not the `-600` the handoff specifies: at 11.5px, `-600` on the cream
 * ground is 3.61:1, below the 4.5:1 the design commits to, and 11.5px qualifies for no
 * large-text allowance. See spec.md → Decisions taken → Contrast.
 */
const sectionLabel: React.CSSProperties = {
  fontSize: 11.5,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontWeight: 700,
  color: 'var(--color-neutral-700)',
  padding: '0 12px',
};



const vaultRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  /* Height lives in theme.css (.rail button): an inline minHeight would outrank the
     44px floor the stacked layout applies, which is exactly how it slipped through. */
  padding: '9px 12px',
  borderRadius: 999,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left',
};

const vaultRowSelected: React.CSSProperties = {
  ...vaultRow,
  background: 'var(--color-neutral-100)',
  boxShadow: 'var(--shadow-sm)',
  fontWeight: 700,
};

const newVaultRow: React.CSSProperties = {
  ...vaultRow,
  fontSize: 13.5,
  fontWeight: 600,
  color: 'var(--color-neutral-700)',
};

const rotationChip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 999,
  background: 'var(--color-accent-200)',
  color: 'var(--color-accent-700)',
  fontSize: 11,
  fontWeight: 700,
};

const tagChip: React.CSSProperties = {
  padding: '4px 11px',
  borderRadius: 999,
  border: 'none',
  background: 'var(--color-accent-2-200)',
  color: 'var(--color-accent-2-800)',
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};

const tagChipOn: React.CSSProperties = {
  ...tagChip,
  // White on `--color-accent` is 3.61:1; the deeper step clears 4.5:1 (Decisions taken → Contrast).
  background: 'var(--color-accent-700)',
  color: '#fff',
};

const clearFilters: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '0 12px',
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  color: 'var(--color-accent-700)',
  textDecoration: 'underline',
  textAlign: 'left',
  cursor: 'pointer',
};

const footer: React.CSSProperties = {
  marginTop: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'flex-start',
};

const accountPill: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 10px',
  borderRadius: 999,
  background: 'var(--color-neutral-100)',
  fontSize: 12.5,
  overflow: 'hidden',
};

const avatar: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  flexShrink: 0,
  borderRadius: 999,
  background: 'var(--color-accent-2-500)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
};

/** Cream mark on terracotta. Clear space here is 9.3-11.6px against a 3.0px rule (FR-011). */
const brandMark: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 34,
  height: 34,
  flexShrink: 0,
  borderRadius: 11,
  background: 'var(--color-accent)',
  color: 'var(--color-bg)',
};

const settingsPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  flex: 1,
  minHeight: 36,
  padding: '8px 12px',
  borderRadius: 999,
  border: '1px solid var(--color-neutral-300)',
  background: 'transparent',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const lockPill: React.CSSProperties = {
  ...settingsPill,
  border: '1px solid transparent',
  background: 'var(--color-accent-2-800)',
  color: 'var(--color-accent-2-100)',
};

const pillInput: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 999,
  border: '1px solid var(--color-neutral-300)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 13.5,
};
