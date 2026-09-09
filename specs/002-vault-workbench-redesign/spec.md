# Feature Specification: Vault Workbench Redesign

**Feature Branch**: `002-vault-workbench-redesign`
**Created**: 2026-09-07
**Status**: Draft
**Input**: Design handoff package at `design_handoff_vault_workbench/` — `README.md` (the specification), `theme.css` (drop-in token replacement), `Vault UX Directions v2.dc.html` (design reference, artboards `2a Unlock` / `2a Vault` / `2a Settings` / `2a Phone`).

## Overview

An information-architecture and visual redesign of the password manager's interface. **No capability is added or removed.** Every screen that exists today still exists; every behaviour it has today it still has. What changes is how the same information is arranged and how it looks.

Three structural changes carry the value:

1. **Four stacked navigation strips become one permanent left rail.** Today the account bar, the vault switcher, the vault tabs and the filter strip each occupy a horizontal band above the content, so the list starts far down the page and the user's context is spread across four rows.
2. **The secret list becomes one line per secret, with a detail pane.** Today every row renders every field of every secret, plus a folder dropdown and one button per tag. A vault of two dozen secrets is thousands of pixels of scrolling and nothing can be scanned. The list becomes a title and a summary line; fields, custom fields, filing and tagging move to a pane beside it.
3. **Six stacked settings sections become six panels behind an index**, one at a time.

The visual language moves to the "Organic" system: a cream ground, terracotta and sage accents, display headings over a humanist sans, pill controls, and generous container radii.

## Clarifications

### Session 2026-09-07

- Q: How should the layout behave between the phone breakpoint (640px) and roughly 900px, where the fixed rail and list leave the detail pane almost no room? → A: Raise the stacked/phone breakpoint from 640px to 900px — below it the drawn phone layout applies (list full width, detail takes over the screen with a way back); the three-pane layout applies only at 900px and above.
- Q: What should a list row show and offer when the secret has no field of the kind the row needs — no non-sensitive field for the summary, or no sensitive field for quick-copy? → A: Omit rather than fake, per FR-030. The summary falls back to `template.name · folderName`; the quick-copy button is not rendered. Custom fields are searched for a non-sensitive value before giving up.
- Q: Where should the add and edit forms render in the new three-pane layout, and what should Cancel return the user to? → A: Inside the detail pane, replacing the read view. Editing keeps the row selected and Cancel returns to that secret's read view; creating clears selection and Cancel returns to the "choose a secret" prompt. Below 900px the pane is already full-screen, so the form is too.
- Q: How should keyboard users move through the secret list — one tab stop per row, or one tab stop for the whole list with arrow keys? → A: Each row is a `<button>` and its own tab stop, with the quick-copy control a second stop within the row. No composite widget, no roving tabindex, no grid or listbox ARIA.
- Q: Should the search privacy explanation keep its full wording, given the design replaces it with "· searched on this device"? → A: Use the short suffix in the search row, and relocate the full sentence intact to settings, so the explanation still appears somewhere. It is not reworded, only moved.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find and read a secret without scrolling (Priority: P1)

A person with a vault of two dozen secrets opens the application to retrieve one password. They scan a list where each secret occupies a single line, recognise the one they want, select it, and read or copy the field they need from the pane beside the list.

**Why this priority**: This is the product's central task and the one the current interface serves worst. Everything else in this redesign is subordinate to it. Delivered alone, it is already the majority of the improvement.

**Independent Test**: Store 24 secrets across several types. Confirm that the page itself never scrolls, that the list column scrolls on its own to reach all 24 (SC-001), that selecting a row shows that secret's fields beside the list, and that reading, revealing and copying a field all behave exactly as they do today.

**Acceptance Scenarios**:

1. **Given** a vault holding 24 secrets, **When** the vault opens, **Then** every secret occupies one line showing its title and a single summary line, and no secret's field values appear in the list.
2. **Given** the list, **When** a row is selected, **Then** that secret's fields, custom fields, folder and tags appear in the detail pane, and the row is visibly marked as selected.
3. **Given** a selected secret with a sensitive field, **When** the reveal control is used, **Then** the value is shown and re-hides itself after the same interval as today.
4. **Given** a selected secret, **When** a field is copied, **Then** the same countdown and the same acknowledgement wording appear as today, and the clipboard is cleared after the same interval.
5. **Given** no selection, **When** the vault opens, **Then** the detail pane shows a short prompt to choose a secret rather than an empty box.

---

### User Story 2 - Reach every navigation control from one place (Priority: P1)

A person switches vault, narrows to a folder, adds a tag filter, checks how long until the vault locks itself, and opens settings — all from a single rail that is always visible, without the content below shifting.

**Why this priority**: The rail is the frame that Story 1 sits inside; the list and detail panes cannot be laid out until it exists. It is equally essential and is listed second only because it is built second.

**Independent Test**: With two vaults, several folders and several tags, confirm each control works from the rail and that filtering behaves exactly as it does today — folder selection exclusive, tags narrowing together, and an explicit choice for secrets with no folder.

**Acceptance Scenarios**:

1. **Given** more than one vault, **When** a vault is chosen from the rail, **Then** the list shows that vault's secrets and the choice is visibly marked.
2. **Given** a vault being re-encrypted, **When** the rail is shown, **Then** that vault carries a state marker explaining that re-encryption is in progress.
3. **Given** folders exist, **When** one is selected, **Then** the list narrows to it and any previously selected folder is deselected.
4. **Given** tags exist, **When** two are selected, **Then** the list shows only secrets carrying both.
5. **Given** any filter is active, **When** the rail is shown, **Then** a control to clear filters is offered; when no filter is active it is absent.
6. **Given** an unlocked vault, **When** the rail is shown, **Then** the time remaining before automatic locking is displayed and counts down.

---

### User Story 3 - Do one account task at a time (Priority: P2)

A person opens settings to change their master password, sees only that task, completes it, and returns to the vault.

**Why this priority**: Real improvement, but settings are visited rarely compared with the vault. The current stacked page is cluttered rather than broken.

**Independent Test**: Open settings and confirm exactly one task is on screen at a time, that all six remain reachable, and that each behaves as it does today.

**Acceptance Scenarios**:

1. **Given** settings, **When** it opens, **Then** an index of six tasks is shown with one selected and only that task's content visible.
2. **Given** a settings task, **When** another is chosen, **Then** the content is replaced and the new choice is marked.
3. **Given** settings, **When** the return control is used, **Then** the vault is shown again in the state it was left.
4. **Given** state that is already loaded — remaining backup codes, whether offline access is on, the count of failed sign-ins — **When** the index is shown, **Then** that state may appear beside its row; when it has not loaded, nothing is shown in its place.
5. **Given** an unverified email address, **When** settings is open, **Then** verification remains a notice rather than becoming a settings task.

---

### User Story 4 - Complete every task on a phone (Priority: P2)

A person on a 360-pixel-wide screen unlocks, searches, reads a secret, copies a field, and files it — with no horizontal scrolling and no control too small to hit.

**Why this priority**: The application already guarantees this, and the redesign must not lose it. It is a regression risk rather than a new capability.

**Independent Test**: At 360px, walk each primary task and confirm no horizontal scroll appears and every interactive target meets the minimum size.

**Acceptance Scenarios**:

1. **Given** a 360px viewport, **When** any screen is shown, **Then** the page does not scroll horizontally.
2. **Given** a 360px viewport, **When** the vault is shown, **Then** the rail's contents remain reachable rather than hidden.
3. **Given** a 360px viewport, **When** a secret is selected, **Then** its detail fills the screen and offers a way back to the list.
4. **Given** a 360px viewport, **When** any control is measured, **Then** its touch target is at least 44 pixels.

---

### Edge Cases

- **Selection outlives its secret**: a selected secret that is filtered, searched, or deleted out of the list must clear the selection rather than leave the detail pane showing something no longer present.
- **Offline**: with the device reading its cached copy, creating, editing, deleting, filing and tagging are all withdrawn from both list and detail, and the existing explanation that nothing is queued is shown.
- **Auto-lock during use**: when the keyring clears, every pane must become unreachable in the same instant, exactly as today — the countdown is a display of that deadline, never the thing that enforces it.
- **A secret whose template version is superseded**: the detail pane must still render it under the version it was written with.
- **A secret with no non-sensitive field, or no sensitive field**: the row omits the summary's third part and the quick-copy control respectively, rather than showing a placeholder or an inert button. The same rule covers a secret whose fields are all empty.
- **A vault with no secrets, and a filter matching none**: each keeps its current wording.
- **A save refused by concurrent edit**: the existing conflict message appears in the detail pane, above the form.
- **Dark-mode users**: the supplied theme is a single warm light theme with no dark variant, so a user whose system prefers dark will now be served light. This is a deliberate consequence of the design, and the browser must be told so its form controls match.
- **A template added after this work ships**: it must receive a colour treatment in the list with no code change.

## Requirements *(mandatory)*

### Functional Requirements

#### Preservation (the hard constraint)

- **FR-001**: The redesign MUST NOT add or remove any capability. Every screen, control and message that exists before it exists after.
- **FR-002**: Every user-facing string MUST be either an existing string from the application or one quoted in the handoff README. Security explanations, warnings and error messages MUST NOT be reworded.
- **FR-002a**: The search row MUST carry the handoff's short form *"· searched on this device"*. The existing explanation *"Runs entirely on this device — the server cannot read your titles, so it cannot search them."* MUST NOT be deleted: it MUST appear verbatim in the **Offline access** settings panel, which is the existing panel that covers what the device does locally. It MUST NOT become a seventh settings task, and MUST NOT be reworded to fit. Relocation is permitted here precisely because the wording is preserved; FR-002's prohibition on rewording is unchanged.
- **FR-002b**: The copy changes this redesign is permitted to make are exactly these, and no others may be introduced without amending this list:
  1. The search placeholder shortens from *"Search titles, folders, tags…  (press /)"* to *"Search titles, folders, tags"*, because the `/` hint becomes a badge (FR-026d).
  2. The count line gains the suffix *"· searched on this device"*, with the full sentence relocated per FR-002a.
  3. The settings return control is renamed from *"Close settings"* to *"Back to the vault"*.
  4. The row of one button per template is replaced by the single label *"New secret"* (FR-018); the per-template labels move into the type-choice list unchanged.
  5. New labels quoted in the handoff for structure that has no equivalent today: *"Vault"*, *"All secrets"*, *"Unfiled"*, *"Folders"*, *"Manage"*, *"Tags"*, *"— narrow together"*, *"New vault"*, *"Account"*, *"Locks in mm:ss"*, and the empty-detail prompt *"Choose a secret to see its fields."*
  6. The vault tab *"Folders & tags"* is replaced by the rail's *"Manage"* link and, in the stacked layout, the *"Organise"* section label. The tabs themselves are removed by FR-013; these are the labels that take over their job.
  7. The rail's re-encryption marker reads *"Re-encrypting after a revocation"*, the handoff's wording, in place of *"Re-encryption in progress"*.
  8. The relative-time forms of FR-030e — *"just now"*, *"N minutes ago"*, *"N hours ago"*, *"N days ago"* — which describe a value that was never displayed before.
  9. Accessible names for structure that did not exist: *"Vault navigation"*, *"Account settings"*, *"Sections"*. These name new landmarks; they replace nothing.
  Every entry above was confirmed against the pre-redesign tree by the string diff of T085. No security explanation, warning, error message or dialog copy appears in this list, and none may be added to it. Where a control becomes icon-only its accessible name is unchanged, verbatim — that is FR-025, not a permitted change.
- **FR-003**: Masked values MUST keep a fixed-width mask that does not reveal length, and MUST re-hide themselves automatically after the current interval.
- **FR-004**: Copying MUST keep the visible countdown, the automatic clipboard clearing after the current interval, and the acknowledgements for both a completed clear and a refused clipboard.
- **FR-005**: Search MUST keep its current debounce, its keyboard shortcut to focus, its clearing on Escape, and MUST continue to exclude sensitive field values from the index.
- **FR-006**: Filtering MUST keep folder selection exclusive, tag selection cumulative (a secret must carry all selected tags), and an explicit selection for secrets in no folder.
- **FR-006a**: A "Clear filters" control MUST be offered in the rail beneath the tag chips whenever any filter is active, and MUST be absent when none is. It carries the behaviour that exists today; the rail is only where it now lives.
- **FR-007**: When the device is reading its cached offline copy, creating, editing, deleting, filing and tagging MUST be withdrawn, and the existing offline explanation MUST be shown.
- **FR-008**: The automatic lock MUST keep its current ceiling and clamping. The redesign MUST only read the remaining time; it MUST NOT change when locking happens.
- **FR-008a**: The countdown MUST render as `mm:ss` and MUST be clamped to `00:00` at and beyond the deadline — it MUST NOT display a negative value, and MUST NOT be trusted over the lock itself where a suspended tab or a clock adjustment puts the two out of step. Reaching `00:00` MUST NOT itself trigger the lock (FR-008).
- **FR-009**: When the vault locks, every pane MUST become unreachable in the same instant, as today.
- **FR-010**: A vault being re-encrypted MUST remain visibly marked as such.
- **FR-010a**: A pending re-encryption MUST NOT change the detail pane. The marker is carried by the rail's vault row alone (FR-030b); the selected secret MUST remain readable, revealable and copyable throughout, exactly as today.
- **FR-011**: The refusal of a concurrent conflicting save MUST keep its current message.
- **FR-012**: Both confirmation dialogs MUST keep their copy, and the folder-deletion dialog MUST continue to require an explicit choice with no default.

#### Structure

- **FR-013**: The account bar, vault switcher, vault tabs and filter strip MUST be replaced by a single persistent rail carrying vault selection, scope, folders, tags, the lock countdown, the account and the lock control.
- **FR-013a**: A rail section with nothing to list — no folders, or no tags — MUST be omitted entirely, its heading included. It MUST NOT render an empty section, a hint, or a placeholder row. The scope rows and the footer are always present.
- **FR-013b**: The rail MUST offer navigation to the folders-and-tags screen and to the sharing screen **unconditionally**, whether or not the vault has any folders or tags. These are the two destinations the vault tab strip carried, and FR-013a's rule about omitting empty sections applies to what a section *lists*, never to how a screen is reached. The handoff places the folders link inside the folders section, which makes it absent precisely when a vault has none yet — leaving no way to create the first one — and gives sharing no rail entry at all, so above the breakpoint it disappears. Both would be capability removals, which FR-001 forbids.
- **FR-014**: The secret list MUST show one line per secret: a title and a single summary line. **Sensitive** field values MUST NOT appear in list rows, whether revealed or masked.
- **FR-014a**: The summary line MUST read `template.name · folderName · <first non-sensitive field value>`, where the value is drawn from the secret's template fields in order and, failing that, its custom fields in order. Where the secret has no non-sensitive field with a value — the built-in `Secure Note` has one field and it is sensitive — the third part MUST be omitted along with its separator, leaving `template.name · folderName`. A placeholder, a mask, or the field's label MUST NOT be substituted.
- **FR-014b**: The row's quick-copy control MUST copy the first sensitive field, and MUST NOT be rendered at all where the secret has no sensitive field. It MUST NOT be rendered disabled, and MUST NOT fall back to copying a non-sensitive value.
- **FR-014c**: Title and summary MUST truncate independently, each on its own line, with an ellipsis at the end of the available width. The summary MUST be truncated as one string from the right; its parts MUST NOT be reordered, individually dropped, or preferentially preserved.
- **FR-014d**: The count line MUST be a single left-aligned line carrying the existing count string and the FR-002a suffix. It MUST NOT carry a sort control: sorting is out of scope, and the handoff's own instruction is to drop the control rather than leave it inert.
- **FR-014e**: While secrets are decrypting, the existing *"Decrypting…"* string MUST appear in place of the rows in the list column. The search field, the count line and the create action MUST remain present, and the detail pane MUST be unaffected — keeping its prompt, or the secret it is already showing.
- **FR-015**: A detail pane MUST show the selected secret's fields, custom fields, folder and tags, and MUST be the only place filing and tagging are offered.
- **FR-016**: With no secret selected, the detail pane MUST show a brief prompt rather than an empty region.
- **FR-016a**: The add and edit forms MUST render inside the detail pane, replacing its read view rather than opening a dialog or taking over the window. The rail and the list MUST remain visible and usable at 900 pixels and above; below the breakpoint the detail pane is already full-screen and the form occupies it.
- **FR-016b**: Editing MUST leave the secret selected and its row marked. Cancel, and a completed save, MUST both return the detail pane to that secret's read view. Creating MUST clear the selection; Cancel MUST return the pane to the prompt of FR-016, and a completed save MUST select the newly created secret.
- **FR-016c**: The concurrency-conflict message of FR-011 MUST appear in the detail pane above the form, with the form's entered values preserved so the user does not retype them.
- **FR-017**: Selection MUST survive search and filter changes while the secret remains visible, and MUST clear when it does not.
- **FR-017a**: Switching vault MUST clear the selection and return the detail pane to its prompt, since the selected secret belongs to the vault being left. This is the FR-017 rule applied to a change of vault, not an exception to it.
- **FR-018**: Creating a secret MUST be offered as one action that then presents the type choice, replacing the current row of one button per type.
- **FR-019**: Settings MUST present six tasks behind an index, one visible at a time. Email verification MUST remain a notice, not a settings task.
- **FR-020**: The three notices — offline, invitations, verification — MUST appear at the top of the list column, at most one at a time, in that order of priority.
- **FR-020a**: The three-pane layout (rail, list, detail) MUST apply only at viewports 900 pixels wide and above, where the rail's 262px and the list's 352px leave the detail pane a workable width. Below 900 pixels the stacked layout MUST apply: the list occupies the full width, and selecting a secret gives its detail the screen with an explicit control back to the list. There MUST NOT be a third intermediate layout.

- **FR-020b**: No notice MUST be dismissible. Nothing in the application implements dismissal today — the offline, invitation and verification notices each clear when the condition behind them clears — so the handoff's dismiss `x` would be a new capability, which FR-001 forbids. No notice MUST render a dismiss control.

#### Presentation

- **FR-021**: All colour, type, spacing, radius and shadow values MUST come from the supplied token file. No new colours may be introduced.
- **FR-021a**: Destructive intent MUST NOT be carried by colour alone. `--danger` aliases `--color-accent-700`, which is also the type chip and ordinary link colour, so every destructive control MUST additionally be distinguished by its wording, and dialogs MUST keep the explicit choice FR-012 requires.
- **FR-022**: Undrawn screens MUST be built only from the seven-part component vocabulary in the handoff: pane, pill row, pill input, primary button, secondary button, chip, notice.
- **FR-022a**: The rail's brand row MUST read *"Password Manager"*, the application's existing name. The handoff's *"Keyhouse"* is written as *"(or the product name)"* and introduces no brand; naming the product is outside a presentation redesign.
- **FR-022b**: Tag chips appear in two roles and MUST be visually distinguishable: in the rail they are interactive filter controls carrying an on/off state, and in the detail pane they are non-interactive labels. The detail pane's chips MUST NOT be focusable or announce themselves as controls.
- **FR-022c**: The icon library MUST be pinned to an exact version, and every icon named in the handoff MUST be confirmed to exist under that name at that version before use. Where a name does not resolve, the substitute MUST come from the same library and MUST be recorded; an icon MUST NOT be drawn by hand or sourced elsewhere.
- **FR-023**: A secret's colour treatment in the list MUST be derived from its template name by a stable hash, so a template added later receives one with no code change.
- **FR-023a**: The row avatar MUST show the first character of the title as a single grapheme cluster, so that an emoji, an accented letter or a non-Latin character renders whole. It MUST be uppercased only where the script has case. A title that is empty or begins with whitespace MUST render the avatar with no character rather than substituting one.
- **FR-024**: Transitions MUST be limited to background and shadow. Nothing may animate position, and there may be no entrance animations. Motion MUST be suppressed entirely when the viewer has asked for reduced motion.

#### Accessibility

- **FR-025**: Every control that becomes icon-only MUST keep its existing accessible label verbatim.
- **FR-026**: Keyboard focus MUST be visible on every interactive element.
- **FR-026a**: Each list row MUST be a native `<button>` and its own tab stop, with the row's quick-copy control a second tab stop within the row. The list MUST NOT be a composite widget: no roving tabindex, and no `grid` or `listbox` ARIA roles. Selection state MUST be exposed with `aria-pressed` on the row.
- **FR-026b**: At 900 pixels and above, activating a row MUST leave focus on that row; the detail pane MUST follow the list in DOM order so Tab reaches it. Below the breakpoint, where the detail pane takes over the screen, activating a row MUST move focus into the detail pane, and the control returning to the list MUST restore focus to the row it came from.
- **FR-026c**: The lock countdown MUST NOT be announced as it ticks — it MUST NOT be inside an assertive live region, and MUST NOT update a polite one every second. The remaining time MUST stay available on demand to assistive technology.
- **FR-026d**: The `/` keyboard-shortcut badge on the search input is a visual affordance and MUST be hidden from assistive technology; the shortcut itself MUST remain as it is today.
- **FR-027**: Every interactive target MUST be at least 44 pixels below the 900-pixel breakpoint, where the stacked layout applies. At 900 pixels and above the detail pane's 32-pixel round icon buttons are permitted, as the handoff specifies them.
- **FR-027a**: The 44-pixel minimum MUST be verified by measuring rendered targets in an automated test, not by asserting a stylesheet rule. The current stylesheet sets 36 pixels and no test has ever measured it, so this is a gap to close rather than a guarantee to preserve.
- **FR-028**: No page MUST scroll horizontally at 360 pixels wide.
- **FR-029**: Interface text MUST NOT fall below the minimum sizes the design system sets.

- **FR-029a**: Every text-and-background pair the interface actually renders MUST meet WCAG AA — 4.5:1 for normal text, 3:1 for text at 18.66px bold or 24px regular and above. This applies to the token set as a whole, not only to the one pair the handoff asserts. The two known failures and their resolutions are recorded under "Decisions taken"; any further pair found below the threshold MUST be raised rather than shipped.

#### Data honesty

- **FR-030**: Every value displayed MUST be sourced from data the application already holds. Where a described value cannot be sourced, the interface element MUST be omitted rather than faked or left inert.
- **FR-030a**: The rail MUST NOT offer a "Recently used" scope. Nothing records when a secret was used, and last-changed answers a different question. The scope list is therefore exactly two rows — *"All secrets"* and *"Unfiled"* — wherever the handoff describes three.
- **FR-030b**: The rail's re-encryption marker MUST show only that a rotation is pending. It MUST NOT show progress or a percentage.
- **FR-030c**: The detail footer MUST NOT claim a member count. For a personal vault it MAY state that only the owner can see the secret, which is derivable today.
- **FR-030d**: The interface MUST render one light theme. It MUST NOT ship a partial dark theme, and the page MUST declare only the scheme it actually supports.
- **FR-030e**: The detail footer's relative timestamp MUST be rendered from the carried-through value with these thresholds: under a minute *"just now"*; under an hour in whole minutes; under a day in whole hours; under a week in whole days; and from a week onward an absolute date rather than a relative phrase. It MUST be labelled as when the secret was last **changed**, never as when it was used (FR-030a).
- **FR-031**: Fonts MUST be available without a network request, so that an offline unlock renders in the intended faces. The two faces — Caprasimo and Figtree — MUST be self-hosted and listed in the service worker's precache manifest, replacing the handoff's `@import` from a font CDN. Verification is that the fonts render with the network disabled on a cold load, not merely that the files exist.
- **FR-031a**: Both faces' licences MUST be confirmed to permit self-hosting and redistribution before the files are vendored, and the licence file each requires MUST ship alongside them.

#### Verification

- **FR-032**: The existing automated tests MUST be updated to match the redesigned interface, and MUST continue to assert the same behaviours. Tests MUST NOT be weakened or deleted to accommodate the new structure.

### Key Entities

No new data. The redesign introduces presentation state only:

- **Selected secret** — which secret the detail pane is showing. Cleared when that secret leaves the visible list.
- **Selected settings task** — which of the six account tasks is on screen.
- **Lock deadline** — the moment the vault will lock itself, read for display. The lock itself is unchanged.
- **Filter state** — unchanged in meaning; rendered in the rail instead of a strip above the list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a 900-pixel-tall window, the list column shows at least 11 secrets without scrolling, and a vault of 24 is reachable by scrolling the list column alone — never the page, which does not scroll. Measured against the handoff's row budget: a two-line row is 58 pixels (10px padding twice, over a 36px avatar beside two text lines totalling 38px) plus a 3px gap, against roughly 724 pixels of column left once the 16px page padding, the search pill, the count line, the create button and their 12px gaps are taken. Today the same vault requires several screens of scrolling **of the page itself**, which is the regression this removes. See discrepancy 9 — the original "24 without scrolling" is not achievable at this row height and awaits a ruling.
- **SC-002**: Reading a specific secret's field takes at most two interactions from the unlocked vault — select the row, reveal or copy the field.
- **SC-003**: Every behaviour listed under Preservation is demonstrated to be unchanged, item by item, after the redesign.
- **SC-004**: Every primary task is completable at 360 pixels wide with no horizontal scrolling and no target smaller than 44 pixels.
- **SC-005**: Every user-facing string after the redesign is traceable to a string in the codebase before it, to a string quoted in the handoff README, or to the enumerated permitted changes of FR-002b. The check is finite: the FR-002b list is the whole of what may differ.
- **SC-006**: A newly defined secret type receives a colour treatment in the list with no code change.
- **SC-007**: A vault unlocked with no network renders in the intended typefaces.
- **SC-008**: The existing test suites pass, with changes limited to selectors and structure — no assertion about behaviour is removed.

## Assumptions

- **The codebase is authoritative where it and the handoff disagree.** Discrepancies found during specification are listed below; more may surface during implementation and are to be reported rather than guessed at.
- **The handoff README is the specification**; the HTML reference is a visual guide whose markup and sample data are not to be carried across.
- The `2b` artboards are rejected and out of scope.
- Work proceeds in the eight steps the handoff sets out, pausing after each for review.
- Four pieces of the handoff are **cut or deferred** by decision, recorded under "Decisions taken" below: the "Recently used" scope, the rotation percentage in the rail, the member count in the detail footer, and dark mode.
- The redesign is presentation-only apart from two additions: exposing the lock deadline for the countdown, and carrying an existing timestamp through to the client for the detail footer.
- Introducing an icon library is acceptable; it carries no cryptographic or authentication responsibility.

## Discrepancies found between the handoff and the codebase

Recorded during specification, verified against the source. The codebase wins in each case.
Five were put to the product owner on 2026-09-07; their decisions are in the next section.

1. **The handoff says React 18; the application is on React 19.** No consequence for this work.

2. **`RotationProgress` is a type, not a component, and its state is local to the sharing screen.** The handoff twice describes the rail showing a percentage "from `RotationProgress`". That progress exists only while the sharing screen is mounted and driving a rotation. Showing it in the rail would require lifting that state into the shell — a structural change the handoff does not acknowledge. The `rotationPending` marker itself is available and unaffected. **Decided: cut the percentage (FR-030b).**

3. **The decrypted secret does not carry a timestamp.** The server returns one on every secret; the client discards it when decrypting. This affects two things the handoff asks for:
   - The detail footer's "relative updated" needs that value carried through — a small, legitimate change, since the data already arrives.
   - **"Recently used" cannot be honestly implemented.** Nothing records when a secret was *used* — viewing and copying are not tracked. The nearest available value is when it was last *changed*, which is a different fact. **Decided: cut the scope (FR-030a).** The timestamp is still carried through for the footer, where it is labelled for what it is.

4. **Member count is not available where the detail pane needs it.** "Visible to N members" appears in the detail footer, but the member list is fetched only inside the sharing screen and the vault summary carries no count. **Decided: deferred (FR-030c)** — the shared-vault line is omitted for now rather than sourced. The personal-vault case is derivable today and may stay.

5. **The supplied theme removes dark mode.** The current theme has a full dark palette; the replacement has none. Users whose system prefers dark will be served the light theme. The page currently declares support for both, which will need to change or the browser will render form controls dark against a cream page. **Decided: drop it (FR-030d), reversibly** — see the next section for the reasoning and the cost of restoring it.

6. **The handoff refers to "both acknowledgement strings" for copying; there are three states with text** — the countdown while copied, the confirmation once cleared, and the refusal. All three must be preserved.

7. **The end-to-end tests select controls by their visible names, and some of those names change.** The return-from-settings control and the per-template creation buttons are both asserted on today. These are test updates, not behaviour changes, and are covered by FR-032.

8. **The handoff's font import is a network request at load.** It is listed as a known problem in the handoff itself; FR-031 requires it resolved rather than carried forward.

9. **SC-001's "24 secrets without scrolling" is not achievable at the handoff's row height.** Found while making SC-001 measurable. The arithmetic, from the handoff's own values:

   | Piece | Height |
   |---|---|
   | Window | 900px |
   | Page padding (16px twice) | −32px |
   | Search pill, count line, create button, three 12px gaps | −144px |
   | **Left for rows** | **≈724px** |
   | One row: 10px padding twice over max(36px avatar, 38px of two text lines) | 58px |
   | Row + 3px gap | 61px |
   | **24 rows** | **≈1461px** |

   The column fits about **11** rows, not 24 — the design needs roughly twice the height it has. The gap is not marginal, so it cannot be closed by trimming padding.

   This does not undo the improvement. The handoff makes each pane scroll independently and the page not scroll at all, so 24 secrets become one short scroll of a 352px column instead of several screens of the whole page. But the criterion as originally written cannot pass.

   **Not yet decided.** Three resolutions, none of which can be picked without the design's author:
   - **Restate the criterion** to what the design delivers — the list column scrolls, the page does not. Written into SC-001 as the working assumption, because it changes no pixel of the design.
   - **Shrink the row** to about 30px — one line, no avatar — which fits 24 but abandons the two-line summary and the avatar tinting of FR-023.
   - **Change the reference window**, since 24 rows at 61px need roughly a 1630px-tall viewport.

## Decisions taken

Five gaps were put to the product owner during specification. Recorded here so a later reader
finds the reasoning, not just the absence.

### Cut: the "Recently used" scope (FR-030a)

Nothing in the system records when a secret was *used*. Opening and copying are not tracked —
deliberately, since a zero-knowledge design has nowhere useful to keep that. The available
value is when a secret was last *changed*, which would rank a note whose typo was fixed
yesterday above a password used every morning. A scope that quietly answers a different
question than its label is worse than no scope.

**To revisit**: it needs a use-tracking mechanism, which is a product decision with its own
privacy question — where would that record live, and what does it leak?

### Cut: rotation progress in the rail (FR-030b)

`rotationPending` is on every vault summary and stays. The percentage is not: it exists only
inside the sharing screen while that screen is driving the rotation, so surfacing it in the
rail would mean lifting live state into the shell for a number that is absent most of the time.
The marker tells the user what they need — this vault is being re-encrypted.

**To revisit**: lift the progress state into the shell. Worth doing only if rotations become
common enough that watching one from elsewhere matters.

### Deferred: the member count in the detail footer (FR-030c)

The handoff asserts this value "already exists on `DecryptedSecret` / `VaultSummary`". It does
not. Sourcing it means either adding a count to the vault summary or fetching the member list
into the shell — a real change, for one line of text. Deferred rather than cut: it is useful
information, and it becomes cheap the moment anything else needs the member list.

### Dropped: dark mode (FR-030d)

The Organic system defines one warm light theme and supplies one set of token values. Keeping
dark would mean inventing a palette, which this work is explicitly forbidden from doing — and a
mechanical inversion of a cream-and-terracotta system produces muddy browns and breaks the one
contrast guarantee the handoff states (`--color-accent-700` clearing 4.5:1, asserted on cream).

Leaving the existing dark block in place would be worse than removing it: it overrides only the
legacy aliases, so a dark-preferring user would get cream panels from the new tokens with dark
text from the old ones. Half a theme is not a theme.

**What this costs**: dark mode is a real accessibility preference — light sensitivity, migraine,
low vision. Dropping it takes something from those users. The partial mitigation is that this
cream ground is markedly lower-luminance than the white most light themes use.

**To revisit**: it needs a dark token set from the author of the design system, not one derived
here. Once that exists the work is small, because every component already reads from tokens.

### Contrast: darken text on the accent, and the section labels

White on `--color-accent` is **3.61:1** at 15px, and `--color-neutral-600` on the cream ground is
**3.61:1** at 11.5px. Both are below the 4.5:1 the design implicitly commits to, and neither
qualifies for the large-text allowance — Caprasimo ships at weight 400, and 11.5px is far under
the threshold at any weight.

Pending a ruling from the design's author, the defaults are:

| Use | From | To | Contrast |
|---|---|---|---|
| Text on the primary button | white on `--color-accent` | white on `--color-accent-700` | 3.61:1 → **6.81:1** |
| Section labels | `--color-neutral-600` | `--color-neutral-700` | 3.61:1 → **5.53:1** |

`--color-accent-700` is chosen over `--color-accent-800` (10.37:1) because it clears the
requirement while staying recognisably the same terracotta; 800 reads as brown. Note that
`--color-accent-600`, the specified hover colour, is **4.49:1** — it misses by a hair, so it
cannot be the answer either.

`--color-neutral-700` was checked against all three grounds it appears on: cream 5.53:1, surface
4.92:1, neutral-100 6.02:1.

This is a reversible default, not a decision taken over the designer's head. The tokens make it a
one-line change if they prefer a different resolution.

## Out of Scope

- Any change to cryptography, key handling, or the client's request shapes.
- Any change to the server.
- Any new capability. Sorting, "Recently used", rotation progress in the rail, and the shared-vault member count are all excluded — see "Decisions taken".
- The `2b` design direction.
- Dark mode as a supported variant, until a dark palette is supplied.
