# Contract: Preserved Behaviour

The regression contract. Every item below exists today and must behave identically after the
redesign. Each names where it lives now and how it is verified.

This is the document to check off during implementation — the handoff's "Interactions &
behaviour" section, made verifiable.

---

## Masking — `components/SensitiveField.tsx`

| Property | Current value | Must remain |
|---|---|---|
| Mask | `'•'.repeat(12)` — fixed width | Fixed 12 bullets. The real length is itself information |
| Auto-re-hide | 30 000 ms after reveal | Unchanged |
| Toggle label | `Reveal ${label}` / `Hide ${label}` | Verbatim, as `aria-label` on the icon button |
| Authority for masking | `field.sensitive` from the template | Unchanged — never a decision of the rendering code |

**Changes**: the text button becomes a 32px round icon button (`eye` / `eye-off`). Nothing else.

**Verified by**: `tests/unit/sensitive-field.test.tsx` (new, written before the change).

---

## Clipboard — `components/CopyButton.tsx`

| Property | Current value | Must remain |
|---|---|---|
| Clear delay | `CLEAR_AFTER_MS = 30_000` | Unchanged |
| Countdown | Ticks 1/s from 30 | Unchanged, though it may move out of the inline row |
| Conditional clear | Only overwrites if the clipboard still holds this value | Unchanged — clobbering a later copy would be worse |
| Copied text | `copied — clipboard clears in {n}s` | Verbatim |
| Cleared text | `clipboard cleared` | Verbatim |
| Refused text | `the browser refused clipboard access` | Verbatim |
| Label | `Copy ${label}` | Verbatim, as `aria-label` |

**Note**: there are **three** text states, not two. The handoff says "both acknowledgement
strings"; the source has copied, cleared and refused.

**Changes**: text button becomes a 32px round icon button (`copy`). The acknowledgement may render
under the row or as a toast instead of inline.

**Verified by**: `tests/unit/copy-button.test.tsx` (new, written before the change).

---

## Search — `features/search/SearchBar.tsx`

| Property | Current value | Must remain |
|---|---|---|
| Debounce | 120 ms | Unchanged |
| Focus shortcut | `/` when not already typing | Unchanged |
| Clear | Escape, when the input has focus; clears and blurs | Unchanged |
| Index contents | Titles, folder and tag names, non-sensitive field values | Unchanged — **sensitive values must stay out** |

**Changes**: placeholder shortens from `Search titles, folders, tags…  (press /)` to
`Search titles, folders, tags` because the `/` hint becomes a visible key badge. The badge must be
`aria-hidden`, since the shortcut is not operable by assistive-technology users the way a control
would be.

**Verified by**: existing `tests/unit/search.test.ts` plus the e2e search test.

---

## Filtering — `features/vault-list/Filters.tsx` → the rail

| Property | Current value | Must remain |
|---|---|---|
| Folder | Exclusive; selecting the active one clears it | Unchanged |
| `UNFILED` | Sentinel `'__unfiled__'` for "no folder" | Unchanged, and still offered as an explicit choice |
| Tags | Cumulative — a secret must carry **every** selected tag | Unchanged |
| Clear filters | Shown only when `folderId !== null || tagIds.length > 0` | Unchanged; becomes a text link under the tag chips |

**Changes**: rendered in the rail instead of a strip. `FilterState`, `NamedItem` and `UNFILED`
keep their current module and exports.

---

## Offline — `App.tsx`, `SecretList.tsx`

When `cached` is set, all of these must be **absent from the DOM**, not merely disabled:

- New secret, Edit, Delete
- The folder filing control and the tag toggles

The existing explanation must show, verbatim: *"Adding and editing need a connection. Reconnect to
make changes — nothing you do here is queued, so nothing will be applied later without you seeing
it."*

**Why absent rather than disabled**: a disabled control invites a second attempt and says nothing
about why. This is the current behaviour and it is the right one.

---

## Auto-lock — `vault/auto-lock.ts`

| Property | Current value | Must remain |
|---|---|---|
| Ceiling | `MAX_MINUTES = 15` | Unchanged |
| Clamping | `min(max(1, floor(requested)), 15)` | Unchanged |
| Activity events | pointerdown, keydown, scroll, touchstart, focus | Unchanged |
| Hidden tab | `visibilitychange` → hidden calls `reset()` | Unchanged |
| On lock | Every pane unreachable in the same tick via `onLockStateChange` | Unchanged |

**Adds**: `getLockAt(): number | null` — read-only.

**Two hazards the tests must pin**:
1. Reading the deadline must not extend it.
2. The once-a-second interval driving the chip must not register as activity. It must be possible
   to leave the chip running and still have the vault lock on schedule.

**Verified by**: `tests/unit/auto-lock.test.ts` (new, written before the change).

---

## Concurrency

The existing refusal message must render in the detail pane, above the form, verbatim:

*"Someone else changed this secret while you were editing. Close and reopen it to see their
version before saving again."*

---

## Rotation

`rotationPending` shows a marker on the vault row with
`title="Re-encrypting after a revocation"`. **No percentage** (FR-030b).

---

## Dialogs — `DeleteDialog`, the folder-disposition dialog in `Organise`

- Copy unchanged in both.
- The delete confirmation must still name the secret and state that deletion cannot be undone.
- **The folder dialog must keep demanding an explicit disposition with no default.** No option may
  be pre-selected, and no button may be styled as the safe default, because there isn't one.

---

## Accessibility

| Property | Must remain |
|---|---|
| Icon-only buttons | Keep their existing `aria-label` verbatim |
| Focus | `:focus-visible` outline visible on every interactive element |
| Touch targets | ≥ 44px at narrow widths — **newly enforced**; the current CSS sets 36px |
| Horizontal scroll | None at 360px |
| Live regions | Status messages keep `role="status"` |

---

## Copy

Every user-facing string is either already in the codebase or quoted in the handoff README. The
following must not be reworded under any circumstances:

- The no-recovery warning on registration and in Change Password
- The offline explanation
- The clipboard acknowledgements
- The concurrency refusal
- The delete confirmation
- The folder-disposition choices
