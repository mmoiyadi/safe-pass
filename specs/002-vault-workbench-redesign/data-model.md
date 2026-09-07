# Phase 1 — Data Model

**This feature adds no persisted data.** No database table, no API field, no request shape and no
stored client record changes. What follows is the *view* state the redesign introduces, plus the
existing shapes it reads — recorded so the next phase knows exactly what may be displayed and what
may not.

---

## New view state

Three values. All are ephemeral, all are lost on reload, and none is written anywhere.

### `selectedSecretId: string | null`

**Owner**: `SecretList.tsx`
**Purpose**: which secret the detail pane renders.

**Rules**:
- Starts `null`. The detail pane shows its empty prompt.
- Set by clicking a row.
- **Must clear when the selected secret leaves the visible list** — filtered out, searched away,
  or deleted. Enforced by deriving from the visible set on each render rather than trusting the
  stored id: if `visible.find(s => s.id === selectedSecretId)` is undefined, treat as no
  selection. This makes the stale case impossible rather than merely handled.
- Survives a filter or search change while the secret is still visible.
- Cleared on lock, with everything else.

### `settingsPanel: 'password' | 'totp' | 'templates' | 'backup' | 'offline' | 'signins'`

**Owner**: `App.tsx`
**Purpose**: which of the six account tasks is on screen.

**Rules**:
- Defaults to `'password'` — the panel the design draws in full, and the task most likely to bring
  someone to settings.
- Resets to the default whenever settings is opened, so a task abandoned last time does not
  reappear.
- Independent of `screen`; leaving and re-entering settings does not preserve it.

### `lockAt: number | null` (read-only projection)

**Owner**: `frontend/src/vault/auto-lock.ts`
**Purpose**: lets the rail display the time remaining.

**Rules**:
- Set inside the existing `reset()` when a timer is armed: `Date.now() + minutes * 60_000`.
- `null` whenever the vault is locked — `reset()` already returns early in that state, so there is
  genuinely no deadline.
- **Read-only to every consumer.** Nothing outside `auto-lock.ts` may set it, and reading it must
  never extend the deadline.
- The ceiling (`MAX_MINUTES = 15`) and the clamping in `configureAutoLock` are untouched.

---

## Existing shapes this feature reads

Recorded because FR-030 forbids displaying anything not sourced from them.

### `DecryptedSecret` (in `SecretList.tsx`)

| Field | Used for |
|---|---|
| `id` | Selection, keys |
| `title` | Row title, detail heading, avatar initial |
| `templateVersionId` | Resolving the template, hence the type chip and the tint |
| `revision` | Detail footer |
| `keyVersion` | Detail footer |
| `folderId` | Folder chip, filing control, filter matching |
| `tagIds` | Tag chips, tag toggles, filter matching |
| `fields` | Detail field rows; the first non-sensitive value in the row summary |
| `custom` | "Your own fields" rows |
| **`updatedAt`** | **Added** (see research §6) — the relative time in the detail footer |

`updatedAt` already arrives on `SecretRecord` and is currently discarded during decryption. Adding
it is a mapping change, not a data change.

### `TemplateVersionRecord`

`name` drives the type chip and — hashed — the row tint. `fields[]` drives the detail rows: each
carries `label`, `order` and `sensitive`. **`sensitive` remains the sole authority for masking**;
the rendering code must not decide what is secret (Principle V).

### `VaultSummary`

`id`, `name` (decrypted upstream), `kind`, `role`, `status`, `rotationPending`, `keyVersion`.

- `kind === 'personal'` gives the detail footer's "Only you" line.
- `rotationPending` gives the rail's re-encryption marker — **the marker only**, no percentage
  (FR-030b).
- **No member count exists here.** The shared-vault footer line is deferred (FR-030c).

### `FilterState` and `NamedItem` (in `Filters.tsx`)

Unchanged in meaning: `folderId: string | null` where `UNFILED` is the sentinel for "no folder",
and `tagIds: string[]` which narrow together. The rail renders them; the semantics do not move.

### `SearchHit`

`matchedIn` appends "· matched in {field}" to a row's summary when it is not the title, as today.

---

## Values the design asks for that are NOT available

Listed so nobody goes looking, and so a later reader knows the absence was deliberate.

| Value | Status | Why |
|---|---|---|
| Last *used* time | Not available | Nothing records reads or copies. `updatedAt` is last **changed** — a different fact (FR-030a) |
| Rotation percentage | Not reachable from the rail | Lives in `Sharing.tsx` local state while that screen drives a rotation (FR-030b) |
| Member count | Deferred | Fetched only inside `Sharing.tsx`; absent from `VaultSummary` (FR-030c) |
| A stable sort order beyond title | Not available | The list arrives ordered by the server; no client sort key is specified |

Each corresponds to a piece of UI that must be **omitted**, not stubbed, not disabled, not filled
with a placeholder.

---

## State that does not move

`screen`, `email`, `offline`, `vaults`, `selectedVaultId`, `templates`, `organise`,
`reauthNeeded`, `pendingTotp`, `verifyToken`, `cachedVaults`, `reloadKey` — all stay exactly where
they are in `App.tsx`, with the same lifetimes. The keyring, the offline snapshot and the search
index are untouched.
