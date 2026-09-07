# Handoff: Vault Workbench (2a)

## Overview

A UI/UX redesign of the zero-knowledge password manager frontend (`frontend/`, React 18 + TypeScript + Vite). No feature is added or removed and no crypto changes: this is an information-architecture and visual redesign of screens that already exist.

Three things change structurally.

1. **The two-level nav becomes a permanent left rail.** Today the account bar (email, Settings, Lock), the `VaultSwitcher` chips, the vault tabs (Secrets / Folders & tags / Sharing) and `Filters` (folder chips, tag chips) are four separate strips stacked above the list. They collapse into one 262px rail that carries vault, scope, folders, tags, the auto-lock countdown, the account and Lock.
2. **The secret list becomes one line per secret, with a detail pane.** Today `SecretList` renders every field of every secret inline, plus a folder `<select>` and one toggle button per tag on each row — so a vault of 24 secrets is thousands of pixels of scrolling and nothing is scannable. The list becomes title + one summary line; fields, custom fields, filing and tagging move into a detail pane on the right.
3. **Settings gets a panel index.** Today `screen === 'settings'` renders `ChangePassword`, `TwoFactor`, `TemplateEditor`, `Backup`, `OfflineAccess` and `SignInHistory` stacked on one page. They become six panels behind a left index, one at a time.

Visually everything moves onto the **Organic** design system: cream ground, terracotta accent, sage second accent, Caprasimo headings over Figtree, pill controls, 28px container radii, Lucide icons at stroke-width 2.75.

## About the design files

`Vault UX Directions v2.dc.html` in this bundle is a **design reference written in HTML** — a prototype of the intended look and behaviour, not production code to copy. Open it in a browser (it needs the sibling `support.js` and `_ds/` folder, both included) and it renders four artboards for this direction, side by side:

- **2a Unlock**, **2a Vault**, **2a Settings**, **2a Phone** — the direction to build.
- The **2b** artboards next to them are the rejected alternative. Ignore them; they are kept only so the reasoning is legible.

The list rows and the reveal (eye) buttons in the prototype are live — click them to see selection and masking behaviour.

The task is to **recreate the 2a artboards inside the existing React app**, using its existing components, hooks and state. Do not port the prototype's markup or its logic class.

## Fidelity

**High fidelity.** Colours, type, spacing, radii and copy are final and are specified below. Recreate them closely. Where the prototype shows placeholder content (secret titles, folder names, sign-in rows), the real data comes from the existing hooks and API calls — nothing in the prototype's sample data should reach the app.

One honest gap: the prototype's screens cover unlock, the vault, and one settings panel. `Organise`, `Sharing`, `TemplateEditor`, `Backup`, `OfflineAccess`, `Register`, `ForgotPassword`, `TotpStep`, `VerifyLanding`, `ReauthPrompt`, `TemplateForm` and both dialogs are **not** drawn. Build them from the component vocabulary in "Design tokens" and "Component vocabulary" below — every one of them is made of the same six or seven parts.

---

## Screens / views

### 1. Unlock (`features/unlock/Unlock.tsx`)

**Purpose** — sign in and derive the master key locally.

**Layout** — one centred card, 560×640, `border-radius: 28px`, `box-shadow: var(--shadow-lg)`, split into two columns:

- **Left panel, 210px wide**, `background: var(--color-accent-2-800)` (#3d472b), `padding: 36px 26px`, `display: flex; flex-direction: column; justify-content: space-between`.
  - Top: a 46px circle, `background: var(--color-accent)`, holding a white `shield` icon at 23px.
  - Bottom: heading in `var(--font-heading)` at 27px / line-height 1.12, colour `var(--color-accent-2-100)`: *"Only you hold the key."* Below it, 13px / 1.5 body in `var(--color-accent-2-300)`: *"Your master password is used here, in this browser, and never sent. The server holds ciphertext it cannot open — so there is no recovery path."*
- **Right column, flexible**, `padding: 44px 34px`, vertically centred.
  - `<h3>` *"Unlock your vault"* (25px Caprasimo).
  - Labels: 13px, weight 600, `var(--color-neutral-700)`, 6px below-gap. Copy unchanged: *"Email address"*, *"Master password"*.
  - Inputs: `padding: 12px 18px`, `border: 1px solid var(--color-neutral-300)`, `border-radius: 999px`, `background: var(--color-neutral-100)`, 15px text, full width. 18px gap between the two fields.
  - Submit: full width, `padding: 14px 22px`, `border-radius: 999px`, `background: var(--color-accent)`, white 15px Caprasimo. Hover `var(--color-accent-600)`. Label is the existing `busy ? 'Deriving your key…' : 'Unlock'`.
  - Busy explainer (existing copy, now always visible while busy): `hourglass` icon 15px + 12.5px/1.45 text in `var(--color-neutral-700)`: *"This takes a moment on purpose. A slow derivation is what makes guessing your password expensive."*
  - Offline hint — render only when `isOfflineEnabled()` and a snapshot exists for the typed address: 10px 14px, `border-radius: 16px`, `background: var(--color-accent-2-200)`, text `var(--color-accent-2-800)` 12.5px, `cloud-off` icon: *"This device has an encrypted copy — you can unlock offline."*
  - Footer links, 13.5px, 18px apart: *"Create a new vault"* (weight 600, `var(--color-accent-700)`) and *"Forgotten password"* (`var(--color-neutral-700)`). These stay `<button>`s styled as links, as they are today.
  - Errors: 13.5px, `var(--color-accent-700)`, directly above the submit button. Existing error strings are unchanged.

**Note** — `Register`, `ForgotPassword`, `TotpStep`, `VerifyLanding` and `ReauthPrompt` reuse the right-hand column treatment alone in a `.column` wrapper (see `theme.css`), not the split card.

### 2. Vault (the workbench) — `App.tsx` shell + `features/vault-list/*`

**Purpose** — find a secret, read or copy a field, file it, edit it.

**Layout** — full-window, `background: var(--color-bg)`, `padding: 16px`, `display: flex; gap: 16px`. Three panes:

| Pane | Width | Surface |
| --- | --- | --- |
| Rail | 262px fixed | `var(--color-surface)`, radius 28px, `padding: 22px 16px` |
| List | 352px fixed | transparent |
| Detail | flex: 1, `min-width: 0` | `var(--color-neutral-100)`, radius 28px, `padding: 30px 32px` |

Rail and detail are `border-radius: var(--radius-lg)`; the whole thing is one flex row with `gap: 16px`. Each pane scrolls independently (`overflow-y: auto`), the page itself does not.

#### 2.1 Rail (new component — suggested `features/shell/VaultRail.tsx`)

Vertical flex, `gap: 20px`, in this order:

1. **Brand** — 32px terracotta circle with white `shield` icon 17px + *"Keyhouse"* (or the product name) in 19px Caprasimo. `padding: 0 8px`.
2. **Vault** — section label: 11.5px, `letter-spacing: 0.08em`, uppercase, weight 700, `var(--color-neutral-600)`, *"Vault"*. Then one row per active vault from `VaultSwitcher`'s `vaults` prop: `padding: 9px 12px`, `border-radius: 999px`, 14px weight 600, `min-height: 40px`, icon `user` for `kind === 'personal'` and `users` otherwise, name truncated with ellipsis. Selected row: `background: var(--color-neutral-100)`, `box-shadow: var(--shadow-sm)`. Hover on unselected: `var(--color-neutral-100)`.
   - `rotationPending` becomes a chip on the right instead of today's `⟳` glyph: `padding: 2px 8px`, `border-radius: 999px`, `background: var(--color-accent-200)`, text `var(--color-accent-700)` 11px weight 700, `refresh-cw` icon 11px, and the percentage from `RotationProgress` if a rotation is being driven in this tab (otherwise just the icon). `title="Re-encrypting after a revocation"`.
   - Last row: *"New vault"* with a `plus` icon, 13.5px `var(--color-neutral-700)` — opens the existing inline create form, which becomes a pill input + pill *Create* / *Cancel* pair inside the rail.
3. **Scopes** — three rows, 14px weight 600, `padding: 9px 12px`, pill radius, icon 16px on the left and a count in 12px weight 700 `var(--color-neutral-600)` on the right: *"All secrets"* (`key-round`), *"Recently used"* (`clock`), *"Unfiled"* (`inbox`). "Unfiled" sets `FilterState.folderId = UNFILED`; "All secrets" clears filters. "Recently used" is new UI over existing data — sort by the newest `revision` timestamp available; if the API does not expose one, omit this row rather than fake it.
4. **Folders** — header row: the uppercase label *"Folders"* plus a *"Manage"* link (12px, weight 600) that navigates to `screen = 'organise'`. Then one row per folder from `Filters`' `folders` prop: `padding: 8px 12px`, 13.5px, `folder` icon 15px, count on the right in 12px `var(--color-neutral-600)`. Selecting one sets `FilterState.folderId`; the selected row takes the same selected treatment as a vault row. Folder selection stays exclusive.
5. **Tags** — uppercase label *"Tags"* followed, in the same line at 400 weight and no letter-spacing, by *"— narrow together"* (this is where the AND semantics get explained, replacing nothing that exists today). Chips wrap, `gap: 6px`: `padding: 4px 11px`, `border-radius: 999px`, 12.5px weight 600. Off: `background: var(--color-accent-2-200)`, text `var(--color-accent-2-800)`. On: `background: var(--color-accent)`, white. The count sits inside the chip at `opacity: 0.6`.
6. **Footer** (`margin-top: auto`, `gap: 8px`)
   - **Auto-lock countdown** — pill, `padding: 7px 11px`, `background: var(--color-accent-2-200)`, text `var(--color-accent-2-800)` 12.5px weight 600, `timer` icon: *"Locks in 12:40"*. **This needs a small addition to `vault/auto-lock.ts`**, which currently exposes no remaining time: record `lockAt = Date.now() + minutes * 60_000` inside `reset()`, export `subscribeRemaining(cb)` (or a `getLockAt()` the component polls once a second), and re-render `mm:ss`. Keep the 15-minute ceiling and clamping exactly as they are. When under 60s, switch the chip to `background: var(--color-accent-200)`, text `var(--color-accent-700)`.
   - **Account** — pill, `background: var(--color-neutral-100)`: 26px sage circle (`var(--color-accent-2-500)`, white 12px weight 700 initial) + the address at 12.5px, truncated.
   - **Actions** — two pills side by side, `gap: 6px`. *Settings*: flex 1, `border: 1px solid var(--color-neutral-300)`, transparent, 13px weight 600, `settings` icon; hover `var(--color-neutral-100)`. *Lock*: `background: var(--color-accent-2-800)`, text `var(--color-accent-2-100)`, `lock` icon; hover `var(--color-accent-2-900)`. Both keep their current handlers (`setScreen`, `lock()`).

#### 2.2 Notices

`offline`, `VerifyBanner` and `IncomingInvitations` currently stack above everything and push the vault down. They move to the **top of the list column**, at most one visible at a time in this priority: offline → invitations → verify. Each is `padding: 11px 14px`, `border-radius: 16px`, 12.5px/1.45, `background: var(--color-accent-200)`, text `var(--color-accent-800)`, a 15px leading icon (`cloud-off`, `mail`, `mail-check`) and a dismiss `x` where the current markup allows dismissal. Copy is unchanged from `App.tsx`, `VerifyEmail.tsx` and `IncomingInvitations.tsx`.

#### 2.3 List column (`SecretList.tsx`, split — suggested `SecretListColumn.tsx`)

Vertical flex, `gap: 12px`:

- **Search** (`features/search/SearchBar.tsx`) — pill, `padding: 12px 18px`, `background: var(--color-neutral-100)`, `border: 1px solid var(--color-neutral-300)`, `search` icon 16px in `var(--color-neutral-600)`, 14px input, and a keyboard badge on the right: `padding: 1px 7px`, `border-radius: 6px`, `background: var(--color-neutral-200)`, 11.5px weight 700 — `/`. The existing `/`-to-focus and Escape-to-clear behaviour and the 120ms debounce are unchanged. Placeholder shortens to *"Search titles, folders, tags"* because the `/` hint is now a badge.
- **Count line** — 12.5px `var(--color-neutral-700)`, `padding: 0 8px`, left: the existing count string, now suffixed *"· searched on this device"* (the long privacy sentence moves here in short form). Right: a sort control, *"Title A–Z"* + `chevron-down`, 12.5px. Sorting is new UI; if you do not want to implement it, drop the control rather than leaving it inert.
- **Rows** — `gap: 3px`, each row `display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 20px; min-height: 44px; cursor: pointer`.
  - **Avatar** — 36px circle, first letter of the title, weight 700 at 14px. Tint by template name: Login → `var(--color-accent-200)` on `var(--color-accent-700)`; Credit card → `var(--color-accent-2-200)` on `var(--color-accent-2-800)`; Secure note → `var(--color-neutral-200)` on `var(--color-neutral-800)`; anything else → `var(--color-neutral-300)` on `var(--color-neutral-900)`. Derive the tint from a hash of `template.name` so a template added tomorrow gets a tint without a code change (Principle V) — do not switch on type names.
  - **Two lines** — title 14.5px weight 600, truncated; summary 12.5px `var(--color-neutral-700)`, truncated: `template.name · folderName · <first non-sensitive field value>`, and when a `SearchHit` has `matchedIn !== 'title'`, append `· matched in <matchedIn>` as today.
  - **Quick copy** — a 32px round icon button on the right, `copy` icon 15px, `var(--color-neutral-600)`, hover `background: var(--color-neutral-200)`. It copies the first sensitive field via the existing `CopyButton` logic; keep the "clipboard clears in Ns" acknowledgement, rendered as a 12px line under the row or a toast rather than inline text.
  - **Selected row**: `background: var(--color-neutral-100)`, `box-shadow: var(--shadow-sm)`. Hover unselected: `var(--color-neutral-100)`.
  - Empty states keep their current copy at 13px `var(--color-neutral-700)`.
- **New secret** — one pill button at the bottom of the column, full width, `padding: 13px`, `background: var(--color-accent)`, white 15px Caprasimo, `plus` icon: *"New secret"*. It replaces the current row of one button per template at the page foot. Clicking it opens the template choice (`templates.map`) as a small pill list in the detail pane, then `TemplateForm` in the detail pane.

#### 2.4 Detail pane (new — suggested `features/secret-detail/SecretDetail.tsx`)

Vertical flex, `gap: 22px`. Shows the selected secret; with no selection, show a short empty state (`key-round` icon at 28px in `var(--color-neutral-400)` and *"Choose a secret to see its fields."*).

- **Header** — a chip row then the title.
  - Template chip: `padding: 3px 11px`, pill, `background: var(--color-accent-200)`, text `var(--color-accent-700)`, 12px weight 700 — `template.name`.
  - Folder chip: `background: var(--color-accent-2-200)`, text `var(--color-accent-2-800)`, 12px weight 600, `folder` icon 12px — folder name or *"Unfiled"*.
  - Tag chips: `border: 1px solid var(--color-neutral-300)`, transparent, 12px `var(--color-neutral-700)`.
  - Title: `<h3>` 25px Caprasimo, no margin.
  - Right: *Edit* pill (`border: 1px solid var(--color-neutral-300)`, 13.5px weight 600, `pencil` icon; hover `var(--color-neutral-200)`) and a 36px round *Delete* icon button (`trash-2`, `var(--color-accent-700)`, hover `background: var(--color-accent-200)`). Both hidden when `cached` (offline), as today.
- **Field rows** — one per template field with a non-empty value, ordered by `field.order`, `gap: 2px`:
  - Grid `132px minmax(0,1fr) auto`, `align-items: center`, `gap: 16px`, `padding: 13px 14px`, `border-radius: 16px`. Hover: `background: var(--color-neutral-200)`.
  - Label 13px weight 600 `var(--color-neutral-700)`.
  - Value 14.5px, `overflow-wrap: anywhere`. Sensitive values are monospace (`ui-monospace, SFMono-Regular, Menlo, monospace`, `letter-spacing: 0.03em`) and masked as today by `SensitiveField` — keep the fixed 12-bullet mask and the 30-second auto-re-hide.
  - Actions: two 32px round icon buttons, `eye` / `eye-off` (only when `field.sensitive`) and `copy`. `var(--color-neutral-700)`, hover `background: var(--color-neutral-300)`. `SensitiveField`'s "Reveal"/"Hide" text button and `CopyButton`'s "Copy" text button become these icon buttons; keep both components' behaviour and their `aria-label`s verbatim.
- **Custom fields** — same rows under an uppercase 11.5px `var(--color-neutral-600)` heading *"Your own fields"*, rendered only when `item.custom.length > 0` (`CustomFieldList`).
- **Filing** — this is where the per-row folder `<select>` and tag toggles from today's list go. Folder: a pill `<select>`-equivalent (or a pill button opening the folder list) reusing the existing `file(secret, folderId)` call. Tags: the same chip treatment as the rail, wired to `toggleTag`. Hidden when `cached`.
- **Footer** (`margin-top: auto`, `padding-top: 18px`, `border-top: 1px solid var(--color-divider)`) — left, 12.5px `var(--color-neutral-600)`: `Revision {revision} · encrypted under key v{keyVersion} · {relative updated}`. Right, 12.5px `var(--color-neutral-700)` with a `users` icon: *"Visible to N members"* for a shared vault, *"Only you"* for a personal one. All of these values already exist on `DecryptedSecret` / `VaultSummary`; do not invent any you cannot source.

### 3. Settings (`App.tsx` `screen === 'settings'`)

**Purpose** — one account task at a time.

**Layout** — same 16px-padded two-pane frame as the vault: a 252px rail (`var(--color-surface)`, radius 28px, `padding: 22px 14px`) and a content pane (`var(--color-neutral-100)`, radius 28px, `padding: 34px 36px`).

- **Rail** — a back row (`arrow-left` 16px + *"Back to the vault"*, 13.5px weight 600) which calls the existing settings toggle; the word *"Account"* in 20px Caprasimo; then the six panels as pill rows, `padding: 10px 12px`, 14px, `min-height: 42px`, icon 16px:

  | Row | Icon | Component |
  | --- | --- | --- |
  | Master password | `key-round` | `settings/ChangePassword.tsx` |
  | Two-factor | `smartphone` | `settings/TwoFactor.tsx` |
  | Secret types | `file-text` | `templates/TemplateEditor.tsx` |
  | Backup | `archive` | `settings/backup.tsx` |
  | Offline access | `cloud-off` | `settings/OfflineAccess.tsx` |
  | Recent sign-ins | `history` | `settings/SignInHistory.tsx` |

  Selected row: `background: var(--color-neutral-100)`, weight 700, `box-shadow: var(--shadow-sm)`. A row may carry a state badge on the right (`padding: 2px 8px`, pill, `background: var(--color-accent-200)`, `var(--color-accent-700)`, 11px weight 700) — and only from real state: `status.backupCodesRemaining` ("2 codes"), `isOfflineEnabled()` ("On"), the failure count `SignInHistory` already computes ("2 failed"). No badge when the data is not loaded.

  Email verification is **not** a panel — it stays the `VerifyBanner` rendered from `App.tsx`.

- **Content pane** — each existing settings component keeps its markup and copy but drops its own `<h2>` margin-top and adopts: `<h3>` title, 14px/1.5 explanatory paragraphs (`var(--color-neutral-700)` for the neutral one, `var(--color-text)` where the current code emphasises), pill inputs `padding: 12px 18px` on `var(--color-bg)` inside the pane, and a Caprasimo pill primary button.

  The prototype draws the **Master password** panel in full: title *"Change master password"*, both `ChangePassword` paragraphs verbatim, the *"Current master password"* / *"New master password"* fields, then `StrengthMeter` restyled as five 5px pill segments with `gap: 4px` (filled `var(--color-accent)`, empty `var(--color-neutral-300)`), its label line at 13px weight 700 in `var(--color-accent-700)` (*"Strong — acceptable"*), and the 12-character guidance at 12.5px `var(--color-neutral-700)`. Keep the meter's existing five bands and labels, its `problems`/`suggestions` lines (12.5px, `var(--color-accent-700)`), and the submit disabling on `!strength.acceptable`. The warning box at the foot is `padding: 16px 18px`, radius 16px, `background: var(--color-accent-200)`, text `var(--color-accent-800)` 13.5px, `triangle-alert` icon: *"There is no password reset to fall back on. If you forget this password, nobody — including us — can open the vault."*

### 4. Phone (all screens, ≤ 640px)

The three panes become three levels of one stack; nothing is hidden.

- Rail contents move into a top bar (vault name as a pill with `chevron-down`, a round Lock button) plus a filter chip row under the search pill. Folders and tags open as a sheet from the *"Folders & tags"* chip.
- List rows become cards: `background: var(--color-neutral-100)`, `border-radius: 22px`, `padding: 13px 15px`, `min-height: 56px`, 40px avatar, and a **44px** round copy button (`var(--color-accent-200)` on `var(--color-accent-700)`) — every touch target is at least 44px, as the current `theme.css` already enforces.
- Tapping a row pushes the detail pane as a full screen with a back row.
- A bottom bar replaces the rail footer: *Secrets* (`key-round`), *Organise* (`folder`), a 52px terracotta `plus` circle, *Sharing* (`user-plus`), *Account* (`settings`). Active item `var(--color-accent-700)` weight 700; inactive `var(--color-neutral-700)`. `padding: 10px 12px 24px`, `background: var(--color-surface)`, top border `var(--color-divider)`.
- Notices sit under the top bar, one at a time, same treatment as desktop.

---

## Interactions & behaviour

Everything below already exists; the redesign must not regress it.

- **Selection** — clicking a list row selects it and renders it in the detail pane. Selection is local UI state (`selectedSecretId`); it survives search and filter changes when the secret is still visible, and clears when it is not.
- **Reveal** — per field, via `SensitiveField`: masked by default, fixed 12-bullet mask, auto-re-hides after 30s.
- **Copy** — via `CopyButton`: clipboard cleared after 30s, with the visible countdown and the "clipboard cleared" / "the browser refused clipboard access" acknowledgements preserved.
- **Search** — 120ms debounce, `/` focuses, Escape clears and blurs, sensitive field values stay out of the index.
- **Filters** — folder exclusive, tags AND, `UNFILED` for no folder. "Clear filters" becomes a small text link under the tag chips in the rail, shown only when a filter is active.
- **Auto-lock** — unchanged behaviour; only a remaining-time read is added for the countdown chip. When the keyring clears, the vault panes must become unreachable in the same tick, exactly as `onLockStateChange` does today.
- **Offline** — when `cached` is set, hide New secret, Edit, Delete, filing and tagging, and show the offline notice. Keep the existing copy that nothing is queued.
- **Rotation** — `rotationPending` shows the rail chip; a rotation driven in this tab updates the percentage from `RotationProgress`.
- **Optimistic-concurrency error** — the existing "Someone else changed this secret while you were editing…" message renders in the detail pane above the form, 13.5px `var(--color-accent-700)`.
- **Dialogs** (`DeleteDialog`, the folder-disposition dialog in `Organise`) — backdrop `color-mix(in srgb, var(--color-neutral-900) 34%, transparent)`; panel `background: var(--color-bg)`, `border-radius: 28px`, `padding: 28px 30px`, `max-width: 30rem`, `box-shadow: var(--shadow-lg)`. Title `<h4>`; choice buttons become left-aligned cards (`background: var(--color-neutral-100)`, radius 16px, `padding: 14px 16px`) with the strong line at 14.5px and the consequence line at 12.5px `var(--color-neutral-700)`. The destructive choice takes `border: 1px solid var(--color-accent-700)` and its strong line in `var(--color-accent-700)`. Both dialogs' copy is unchanged — the folder dialog must keep demanding an explicit disposition with no default.
- **Transitions** — 120ms `ease-out` on background and box-shadow for rows, chips and buttons. Nothing animates position. No entrance animations.
- **Focus** — `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`, already in the supplied `theme.css`. Every icon-only button keeps an `aria-label`.

## State management

No new data flows. The redesign adds three pieces of UI state and moves one:

| State | Where | Why |
| --- | --- | --- |
| `selectedSecretId: string \| null` | `SecretList` (or lifted into the vault shell) | Drives the detail pane. |
| `settingsPanel: 'password' \| 'totp' \| 'templates' \| 'backup' \| 'offline' \| 'signins'` | `App.tsx` | One settings panel at a time. |
| `lockAt: number` (or a `subscribeRemaining` subscription) | `vault/auto-lock.ts` → rail | The countdown chip. The only source change outside presentation. |
| `FilterState` | already in `SecretList`; the rail now renders it | Folder and tag chips move into the rail, so pass `state` and `onChange` down to it. |

`screen`, `email`, `offline`, `vaults`, `selectedVaultId`, `templates`, `organise`, `reauthNeeded`, `pendingTotp`, `verifyToken`, `cachedVaults` and `reloadKey` all stay exactly as they are in `App.tsx`.

## Component vocabulary

Undrawn screens are built from these seven parts and nothing else:

1. **Pane** — `var(--color-neutral-100)` or `var(--color-surface)`, `border-radius: 28px`, `padding: 30px 32px`.
2. **Pill row** — `padding: 9px 12px`, `border-radius: 999px`, 14px; selected = `var(--color-neutral-100)` + `var(--shadow-sm)`.
3. **Pill input** — `padding: 12px 18px`, `border: 1px solid var(--color-neutral-300)`, `border-radius: 999px`, `background: var(--color-neutral-100)`, 15px.
4. **Primary button** — `background: var(--color-accent)`, white, Caprasimo 14–15px, `padding: 12px 22px`, pill; hover `var(--color-accent-600)`.
5. **Secondary button** — transparent, `border: 1px solid var(--color-neutral-300)`, 13.5px weight 600, pill; hover `var(--color-neutral-200)`. Destructive variant: border and text `var(--color-accent-700)`, hover `background: var(--color-accent-200)`.
6. **Chip** — `padding: 4px 11px`, pill, 12.5px weight 600. Sage `var(--color-accent-2-200)` / `var(--color-accent-2-800)` for classification; terracotta `var(--color-accent-200)` / `var(--color-accent-700)` for type and state; outline `1px var(--color-neutral-300)` for tags.
7. **Notice** — `padding: 15px 18px`, `border-radius: 16px`, `background: var(--color-accent-200)`, text `var(--color-accent-800)`, 13.5px/1.5, leading 16px icon.

Section labels everywhere: 11.5px, `letter-spacing: 0.08em`, uppercase, weight 700, `var(--color-neutral-600)`.

## Design tokens

Use the supplied `theme.css` — it is a drop-in replacement for `frontend/src/theme.css` and declares every token below, plus aliases (`--bg`, `--fg`, `--muted`, `--border`, `--accent`, `--danger`, `--warn`) pointing at Organic values so components not yet rewritten keep working. Two deliberate changes in it: the `prefers-color-scheme: dark` block is gone (Organic is one warm light theme) and `main { max-width: 46rem }` is gone (the workbench is full-width; single-column screens opt in with `.column`).

**Roles** — bg `#f5ead8`, surface `#ebddc5`, text `#201e1d`, accent `#c67139`, accent-2 `#7a8a5e`, divider `color-mix(in srgb, #201e1d 16%, transparent)`.

**Neutral** 100–900: `#f9f4ed` `#eee7db` `#dcd3c4` `#c0b6a5` `#a19786` `#82796a` `#645c50` `#474238` `#2e2b25`.

**Accent (terracotta)** 100–900: `#fff2eb` `#ffe1d0` `#ffc6a5` `#f6a06b` `#d67f48` `#b2622d` `#8c491a` `#643312` `#402310`.

**Accent-2 (sage)** 100–900: `#f0fae1` `#e1eecc` `#ccdbb2` `#aebf92` `#8fa073` `#728157` `#56633f` `#3d472b` `#272e1b`.

There is **no red** in this system. Destructive and error weight comes from `--color-accent-700` (`#8c491a`) on the cream ground — it clears 4.5:1 and reads as caution without breaking the palette. The supplied `theme.css` points the legacy `--danger` at it.

**Type** — Caprasimo 400 for headings (`--font-heading`), Figtree 400/500/600/700 for everything else (`--font-body`). h1 42 / h2 32 / h3 25 / h4 20 / h5 16, all `line-height: 1.12`, `letter-spacing: -0.015em`. Body 15/1.55. Secondary 13.5–14, meta 12.5, section labels 11.5. Nothing below 11.5px, and no interface text below 12.5px.

**Spacing** — `--space-1..8`: 4.4 / 8.8 / 13.2 / 17.6 / 26.4 / 35.2px. Pane gap 16px, rail section gap 20px, row gap 2–3px.

**Radius** — `--radius-sm` 8, `--radius-md` 16 (field rows, notices, cards), `--radius-lg` 28 (panes, dialogs), `999px` (buttons, inputs, chips, list rows use 20–22px).

**Shadow** — `--shadow-sm` `0 1px 2px #2e2b25 @14%` (selected rows), `--shadow-md` `0 3px 10px @16%` (floating buttons), `--shadow-lg` `0 12px 32px @22%` (dialogs, sheets).

## Assets

- **Fonts** — Caprasimo and Figtree from Google Fonts, imported at the top of the supplied `theme.css`. If the app must work offline (it has a service worker and an offline mode), self-host both and add them to the precache list — a webfont fetched at unlock time will fail in an offline session.
- **Icons** — [Lucide](https://lucide.dev) at **stroke-width 2.75**, sizes 11–24px as specified per component. Install `lucide-react` and import per icon. Icons used: shield, lock, key-round, clock, inbox, folder, users, user, user-plus, plus, search, copy, eye, eye-off, pencil, trash-2, settings, timer, refresh-cw, cloud-off, mail, mail-check, triangle-alert, hourglass, chevron-down, arrow-left, history, archive, file-text, smartphone, list-ordered, x.
- **Images** — none. The design uses no photography or illustration.

## Files in this bundle

| File | What it is |
| --- | --- |
| `README.md` | This document. Self-sufficient — implement from it. |
| `theme.css` | Drop-in replacement for `frontend/src/theme.css`. |
| `Vault UX Directions v2.dc.html` | The design reference. Open in a browser; the **2a** artboards are the direction. |
| `support.js` | Runtime the reference file needs. Not part of the app. |
| `_ds/organic-.../styles.css`, `_ds_bundle.js` | The Organic design-system stylesheet the reference loads. Its `:root` block is the source of the token values above. |

## Suggested order of work

1. Swap `theme.css`. Everything gets warmer and nothing breaks. Confirm the app still works with the legacy aliases in place.
2. Build the rail and the three-pane shell in `App.tsx`; move `VaultSwitcher`, the vault tabs and `Filters` into it. Delete `accountBar`, `vaultTabs`, `vaultTab`, `vaultTabActive`, `navButton`, `navButtonActive`.
3. Split `SecretList` into the list column and the detail pane; move filing and tagging out of the rows. This is the largest single win and the largest diff.
4. Restyle `SensitiveField` and `CopyButton` as icon buttons, keeping their timers and labels.
5. Add the settings index and give each settings panel the pane treatment.
6. Add the auto-lock countdown.
7. Restyle the remaining screens (register, forgot, TOTP, verify, reauth, `TemplateForm`, `Organise`, `Sharing`, `Backup`, dialogs) from the component vocabulary.
8. Check at 360px: no horizontal scroll, every target ≥ 44px, and every primary task completable — the guarantees the current `theme.css` comments already commit to.
