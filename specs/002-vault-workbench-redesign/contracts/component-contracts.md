# Contract: Components

The interface between the pieces. Props and responsibilities for what is new or changed — enough
that the split can be reviewed before it is built, and enough that two people could build the two
panes independently.

Types referenced here already exist; none is introduced.

---

## `features/shell/VaultRail.tsx` (new)

The permanent 262px left column. Replaces the account bar, `VaultSwitcher`, the vault tabs and
`Filters`.

```ts
interface VaultRailProps {
  vaults: VaultWithName[];
  selectedVaultId: string;
  onSelectVault: (id: string) => void;
  onCreateVault: () => Promise<void>;

  screen: Screen;
  onNavigate: (screen: Screen) => void;   // 'vault' | 'organise' | 'sharing' | 'settings'

  folders: NamedItem[];
  tags: NamedItem[];
  counts: { byFolder: Map<string, number>; byTag: Map<string, number>; unfiled: number };
  filters: FilterState;
  onFiltersChange: (next: FilterState) => void;

  email: string;
  onLock: () => void;
  offline: boolean;
}
```

**Responsibilities**: render vault rows (with the `rotationPending` marker), the scope rows, the
folder and tag lists, the countdown chip, the account pill and the Settings/Lock pair.

**Not its responsibility**: owning filter state (it is passed in), fetching anything, or deciding
what a filter means. It renders `FilterState` and reports changes.

**Offline**: "New vault" is hidden when `offline`.

**Accessibility**: the vault list is a `nav`; the selected vault carries `aria-current="true"`.
Every icon-only control has a label.

---

## `features/shell/LockCountdown.tsx` (new)

```ts
// no props — reads the module directly, like the keyring hooks already do
export function LockCountdown(): JSX.Element | null;
```

**Behaviour**: polls `getLockAt()` once a second; renders `Locks in mm:ss`. Returns `null` when
`getLockAt()` is `null` (locked). Under 60 seconds the chip switches to the terracotta treatment.

**Must not**: extend the deadline, or trigger any of the five activity events. The interval must
be cleared on unmount.

**Accessibility**: `role="timer"` with `aria-live="off"` — a countdown announced every second
would make the page unusable with a screen reader. The value is available on demand, not
announced.

---

## `features/shell/Notices.tsx` (new)

```ts
interface NoticesProps {
  offline: boolean;
  invitations: VaultSummary[];
  onInvitationResponded: () => Promise<void>;
}
```

**Behaviour**: renders **at most one** notice, in priority order offline → invitations → verify.
Sits at the top of the list column. Copy comes verbatim from `App.tsx`, `VerifyEmail.tsx` and
`IncomingInvitations.tsx`.

**Why one at a time**: three stacked notices push the vault below the fold, which is the problem
this redesign exists to solve. Priority reflects urgency: an offline session changes what is
possible; an invitation is waiting on the user; verification can wait.

---

## `features/vault-list/SecretList.tsx` (container, reduced)

Keeps: fetching, decryption, filter state, search hits, and every mutation
(`create`, `update`, `remove`, `file`, `toggleTag`). Adds `selectedSecretId`.

**Loses**: all rendering of rows and fields, which moves to the two components below.

**Selection rule**: derived, not merely stored. The selected secret is
`visible.find(s => s.id === selectedSecretId) ?? null`, so a secret filtered or deleted away
cannot leave a stale detail pane. See data-model.md.

---

## `features/vault-list/SecretListColumn.tsx` (new)

```ts
interface SecretListColumnProps {
  items: DecryptedSecret[];              // already filtered and ordered
  hits: Map<string, SearchHit> | null;
  templates: Map<string, TemplateVersionRecord>;
  folderName: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewSecret: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  totalCount: number;
  offline: boolean;
}
```

**Row contents**: avatar (initial, tinted by template-name hash), title, one summary line
(`template.name · folderName · first non-sensitive field value`, plus `· matched in {x}` when a
hit matched elsewhere), and a quick-copy button for the first sensitive field.

**Must not render**: any field value beyond the single summary value, and never a sensitive one.

**Offline**: "New secret" is absent.

---

## `features/secret-detail/SecretDetail.tsx` (new)

```ts
interface SecretDetailProps {
  secret: DecryptedSecret | null;        // null → empty prompt
  template: TemplateVersionRecord | undefined;
  vault: VaultWithName;
  folders: NamedItem[];
  tags: NamedItem[];
  onEdit: () => void;
  onDelete: () => void;
  onFile: (folderId: string | null) => Promise<void>;
  onToggleTag: (tagId: string) => Promise<void>;
  offline: boolean;
  error: string | null;                  // the concurrency refusal, verbatim
}
```

**Sections**, in order: header (type chip, folder chip, tag chips, title, Edit and Delete);
field rows ordered by `field.order`, non-empty only; "Your own fields" when
`secret.custom.length > 0`; filing; footer.

**Footer**: `Revision {revision} · encrypted under key v{keyVersion} · {relative updatedAt}` on the
left. On the right, "Only you" when `vault.kind === 'personal'` — and **nothing at all** for a
shared vault, because the member count is deferred (FR-030c).

**Field rows**: label, value, and up to two icon buttons. `SensitiveField` supplies the mask and
the reveal for `field.sensitive`; `CopyButton` supplies copy. Neither component's behaviour
changes — only its shape.

**Offline**: Edit, Delete, filing and tagging are all absent.

---

## `components/SensitiveField.tsx` and `components/CopyButton.tsx` (changed)

Props unchanged. Only the rendered control changes, from a text button to a 32px round icon
button. Every behaviour and both label formats are fixed by
[preserved-behaviour.md](./preserved-behaviour.md) and pinned by tests written first.

---

## `components/Icon.tsx` (new)

```ts
interface IconProps { name: LucideIconName; size?: number; }
```

Wraps `lucide-react` with `strokeWidth={2.75}` fixed. Icons are `aria-hidden`; the accessible name
lives on the button that contains them.

---

## `vault/auto-lock.ts` (changed — the only non-presentation source change)

```ts
/** The moment the vault will lock, or null when it is already locked. Read-only. */
export function getLockAt(): number | null;
```

Set in the existing `reset()` when the timer is armed; `null` on the early return when locked.
`MAX_MINUTES`, the clamping, the activity events and the visibility handler are untouched.

---

## `App.tsx` (changed)

Owns the three-pane layout and `settingsPanel`. Renders `VaultRail`, the vault content, and the
settings index.

**Deleted styles**: `accountBar`, `vaultTabs`, `vaultTab`, `vaultTabActive`, `navButton`,
`navButtonActive` — dead once the rail exists, and left behind they invite reuse of the old
vocabulary.

**Unchanged**: every existing state value and its lifetime, `onLockStateChange`, the reauth
handler, the verification-token landing, and the offline entry path.
