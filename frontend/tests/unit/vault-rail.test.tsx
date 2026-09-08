/**
 * The rail (T020-T022, T027, FR-006, FR-013a).
 *
 * Covers the rules that are easy to break silently while the thing still looks right: folder
 * selection staying exclusive, tags narrowing rather than widening, empty sections vanishing
 * heading and all, and "Clear filters" appearing only when something is filtered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VaultRail } from '../../src/features/shell/VaultRail.js';
import { UNFILED, type FilterState } from '../../src/features/vault-list/Filters.js';
import type { VaultWithName } from '../../src/features/vault-list/vault-name.js';

vi.mock('../../src/vault/auto-lock.js', () => ({ getLockAt: () => null }));

const vault = (over: Partial<VaultWithName> = {}): VaultWithName =>
  ({
    id: 'v1',
    name: 'enc' as never,
    kind: 'personal',
    keyVersion: 1,
    nameKeyVersion: 1,
    role: 'owner',
    status: 'active',
    rotationPending: false,
    decryptedName: 'Personal',
    ...over,
  }) as VaultWithName;

const noFilters: FilterState = { folderId: null, tagIds: [] };

function renderRail(over: Partial<React.ComponentProps<typeof VaultRail>> = {}) {
  const onFiltersChange = vi.fn();
  const props: React.ComponentProps<typeof VaultRail> = {
    vaults: [vault()],
    selectedVaultId: 'v1',
    onSelectVault: vi.fn(),
    onVaultCreated: vi.fn(async () => {}),
    onNavigate: vi.fn(),
    folders: [],
    tags: [],
    counts: { byFolder: new Map(), byTag: new Map(), unfiled: 0 },
    total: 0,
    filters: noFilters,
    onFiltersChange,
    email: 'a@example.com',
    onLock: vi.fn(),
    offline: false,
    ...over,
  };
  render(<VaultRail {...props} />);
  return { onFiltersChange, props };
}

afterEach(cleanup);

describe('empty sections are omitted entirely (FR-013a)', () => {
  it('renders no Folders heading when there are no folders', () => {
    renderRail();
    expect(screen.queryByText('Folders')).toBeNull();
  });

  it('renders no Tags heading when there are no tags', () => {
    renderRail();
    expect(screen.queryByText(/Tags/)).toBeNull();
  });

  it('renders the headings once there is something to list', () => {
    renderRail({ folders: [{ id: 'f1', name: 'Work' }], tags: [{ id: 't1', name: 'urgent' }] });
    expect(screen.getByText('Folders')).toBeTruthy();
    expect(screen.getByText(/Tags/)).toBeTruthy();
  });
});

describe('filtering (FR-006)', () => {
  it('keeps folder selection exclusive — choosing one replaces the other', () => {
    const { onFiltersChange } = renderRail({
      folders: [
        { id: 'f1', name: 'Work' },
        { id: 'f2', name: 'Home' },
      ],
      filters: { folderId: 'f1', tagIds: [] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(onFiltersChange).toHaveBeenCalledWith({ folderId: 'f2', tagIds: [] });
  });

  it('deselects a folder when it is chosen again', () => {
    const { onFiltersChange } = renderRail({
      folders: [{ id: 'f1', name: 'Work' }],
      filters: { folderId: 'f1', tagIds: [] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Work/ }));
    expect(onFiltersChange).toHaveBeenCalledWith({ folderId: null, tagIds: [] });
  });

  it('accumulates tags rather than replacing them', () => {
    const { onFiltersChange } = renderRail({
      tags: [
        { id: 't1', name: 'urgent' },
        { id: 't2', name: 'work' },
      ],
      filters: { folderId: null, tagIds: ['t1'] },
    });
    fireEvent.click(screen.getByRole('button', { name: /work/ }));
    expect(onFiltersChange).toHaveBeenCalledWith({ folderId: null, tagIds: ['t1', 't2'] });
  });

  it('offers Unfiled explicitly', () => {
    const { onFiltersChange } = renderRail({ counts: { byFolder: new Map(), byTag: new Map(), unfiled: 3 } });
    fireEvent.click(screen.getByRole('button', { name: /Unfiled/ }));
    expect(onFiltersChange).toHaveBeenCalledWith({ folderId: UNFILED, tagIds: [] });
  });
});

describe('Clear filters (FR-006a)', () => {
  it('is absent when nothing is filtered', () => {
    renderRail();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('appears once a filter is active, and clears everything', () => {
    const { onFiltersChange } = renderRail({ filters: { folderId: 'f1', tagIds: ['t1'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ folderId: null, tagIds: [] });
  });
});

describe('vault rows', () => {
  it('marks the selected vault with aria-current (T027)', () => {
    renderRail({ vaults: [vault(), vault({ id: 'v2', decryptedName: 'Shared', kind: 'standard' })] });
    expect(screen.getByRole('button', { name: /Personal/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: /Shared/ }).getAttribute('aria-current')).toBeNull();
  });

  it('marks a vault being re-encrypted, without a percentage (FR-030b)', () => {
    renderRail({ vaults: [vault({ rotationPending: true })] });
    expect(screen.getByTitle('Re-encrypting after a revocation')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Personal/ }).textContent).not.toMatch(/\d+%/);
  });

  it('hides New vault offline, since creating one needs the network (FR-007)', () => {
    renderRail({ offline: true });
    expect(screen.queryByRole('button', { name: /New vault/ })).toBeNull();
  });
});

describe('the product name (FR-022a)', () => {
  it('uses the application name, not the handoff placeholder', () => {
    renderRail();
    expect(screen.getByText('Password Manager')).toBeTruthy();
    expect(screen.queryByText('Keyhouse')).toBeNull();
  });
});
