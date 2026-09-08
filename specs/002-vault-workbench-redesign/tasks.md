---
description: "Task list for the Vault Workbench Redesign"
---

# Tasks: Vault Workbench Redesign

**Input**: Design documents from `/specs/002-vault-workbench-redesign/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks are **mandatory** here, not optional. `vault/auto-lock.ts` is session
lifecycle, which Constitution Principle IV names explicitly; `SensitiveField` and `CopyButton`
implement FR-041 and FR-052. None of the three has a unit test today. Characterisation tests are
written **against the current, unmodified code** and must pass before it changes — a test written
afterwards passes by construction and proves nothing about preservation.

**Organization**: Grouped by user story. The user's eight-step work order is annotated on each
phase as **[Step N]** so the two orders stay legible against each other. Stop at each checkpoint
for review.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: Which user story the task serves (US1–US4)
- Every task names its exact file path

## Path Conventions

Only `frontend/` changes. **No file under `frontend/src/crypto/`,
`frontend/src/vault/keyring.ts`, `frontend/src/vault/session.ts`, `shared/`, or `backend/` may
appear in this feature's diff** (Principle I gate — verify with `git diff --name-only`).

---

## Phase 0: Resolve blocking spec gaps

**Purpose**: Three questions from `checklists/ux.md` that decide what gets built. Answering them
after the code exists means rebuilding it.

- [X] T001 [P] Put the two failing contrast pairs to the design's author and confirm or override the default recorded in `specs/002-vault-workbench-redesign/spec.md` → Decisions taken → Contrast (accent-700 for text on the button, neutral-700 for section labels). **Start this first — it is the only task waiting on someone outside this repository — but it no longer blocks: the default is buildable and reversible** (CHK023)
- [X] T002 [P] Decide and record the row summary for a template with **no non-sensitive field** — the built-in Secure Note has one field and it is `sensitive: true`. Record in `specs/002-vault-workbench-redesign/spec.md` under Decisions taken (CHK001)
- [X] T003 [P] Decide and record quick-copy behaviour for a secret with **no sensitive field** in `specs/002-vault-workbench-redesign/spec.md` (CHK002)

**Checkpoint**: three decisions recorded. Everything below assumes them.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and assets, before any code moves. **[Step 1 prerequisites]**

- [X] T004 Add `lucide-react` pinned to an exact version in `frontend/package.json`
- [X] T005 Add `@testing-library/react` and `@testing-library/user-event` as devDependencies in `frontend/package.json` — the repo has no component-test capability today
- [X] T006 [P] Verify every icon named in the handoff's Assets list exists in the pinned `lucide-react` version; record any that do not in `specs/002-vault-workbench-redesign/research.md` (CHK035)
- [X] T007 [P] Vendor Caprasimo 400 and Figtree 400/500/600/700 as woff2 into `frontend/public/fonts/`, with their OFL licence files alongside (CHK034)
- [X] T008 Add `woff2` to the `injectManifest.globPatterns` precache list in `frontend/vite.config.ts` so an offline unlock renders in the intended faces (FR-031)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The characterisation tests Principle IV requires, plus the token swap everything else
is built on.

**⚠️ CRITICAL**: T009–T012 must pass against the **unmodified** components before any user story
work begins. No user story work may start until this phase completes.

### Characterisation tests — write first, run against current code

- [X] T009 [P] Add `frontend/tests/unit/auto-lock.test.ts` pinning current behaviour: the 15-minute ceiling, the clamping in `configureAutoLock`, reset on activity, and that no deadline exists while locked
- [X] T010 [P] Add `frontend/tests/unit/sensitive-field.test.tsx` pinning the fixed 12-bullet mask, the 30-second auto-re-hide, and both `aria-label` formats (`Reveal ${label}` / `Hide ${label}`)
- [X] T011 [P] Add `frontend/tests/unit/copy-button.test.tsx` pinning the 30-second clipboard clear, the ticking countdown, the conditional overwrite, all **three** text states (`copied — clipboard clears in {n}s`, `clipboard cleared`, `the browser refused clipboard access`) and the `Copy ${label}` label
- [X] T012 Run T009–T011 against unmodified `frontend/src/` and confirm all pass — quickstart V0

### Tokens and shared primitives

- [X] T013 Replace `frontend/src/theme.css` with `design_handoff_vault_workbench/theme.css`, substituting the Google Fonts `@import` for local `@font-face` rules pointing at `frontend/public/fonts/`
- [X] T014 Change `frontend/index.html` `<meta name="color-scheme">` from `light dark` to `light` (FR-030d)
- [X] T015 [P] Add `frontend/src/components/Icon.tsx` wrapping `lucide-react` with `strokeWidth={2.75}` fixed and `aria-hidden` set
- [X] T016 [P] Add `frontend/tests/unit/template-tint.test.ts` asserting a template name always yields the same tint pair and that every output is one of the four permitted pairs (FR-023, Principle V)
- [X] T017 [P] Add the tint function in `frontend/src/features/vault-list/template-tint.ts` — FNV-1a over `template.name`, modulo the four token pairs. Not a switch on type names
- [X] T018 Run `pnpm -r typecheck && pnpm --filter frontend test` and walk every screen confirming the app is warmer and nothing is broken — quickstart V1

**Checkpoint**: **[Step 1 complete — stop for review.]** The legacy aliases carry every
not-yet-rewritten component. Foundation ready.

---

## Phase 3: User Story 2 — Reach every navigation control from one place (Priority: P1)

**Goal**: Four stacked strips become one persistent rail carrying vault, scopes, folders, tags,
the countdown, account and Lock.

**Independent Test**: With two vaults, several folders and several tags, every control works from
the rail and filtering behaves exactly as today — folder exclusive, tags AND-ed, `UNFILED` offered
explicitly.

**Why before US1**: the list and detail panes are laid out inside this shell. US1 is the larger
win; this is the frame it sits in.

### Implementation — the shell and rail **[Step 2]**

- [X] T019 [US2] Build the three-pane flex shell in `frontend/src/App.tsx` — rail 262px, list 352px, detail flex:1 min-width:0, 16px gap, each pane scrolling independently
- [X] T020 [US2] Add `frontend/src/features/shell/VaultRail.tsx` per `contracts/component-contracts.md`, rendering brand, vault rows, scopes, folders, tags and footer
- [X] T021 [US2] Move vault selection and creation from `frontend/src/features/vault-list/VaultSwitcher.tsx` into the rail, including the `rotationPending` marker as a chip with `title="Re-encrypting after a revocation"` — marker only, no percentage (FR-030b)
- [X] T021a [US2] Lift `FilterState` and its setter from `frontend/src/features/vault-list/SecretList.tsx` to `frontend/src/App.tsx`, extending the existing `onDataChanged` seam that already lifts folders, tags and counts. The rail is rendered by `App` and needs both; `SecretList` keeps reading them as props. Without this the rail has nothing to render (FR-006)
- [X] T022 [US2] Move folder and tag filtering from `frontend/src/features/vault-list/Filters.tsx` into the rail, preserving exclusive folders, AND-ed tags, `UNFILED`, and the "Clear filters" link shown only when a filter is active (FR-006)
- [X] T023 [US2] Reduce `frontend/src/features/vault-list/Filters.tsx` to its exported `FilterState`, `NamedItem` and `UNFILED` — both `SecretList` and `App` import them (research §Open questions)
- [X] T024 [US2] Delete `frontend/src/features/vault-list/VaultSwitcher.tsx` and remove its imports
- [X] T025 [US2] Add `frontend/src/features/shell/Notices.tsx` rendering at most one notice at a time in priority offline → invitations → verify, copy verbatim from the current components (FR-020)
- [X] T026 [US2] Delete the dead `accountBar`, `vaultTabs`, `vaultTab`, `vaultTabActive`, `navButton` and `navButtonActive` styles from `frontend/src/App.tsx`
- [X] T027 [US2] Specify and implement the keyboard model for the rail's vault and folder rows in `frontend/src/features/shell/VaultRail.tsx`, with `aria-current` on the selected row (CHK024, FR-026)

### Implementation — the countdown **[Step 6, pulled forward: it belongs to this story]**

- [X] T028 [US2] Extend `frontend/tests/unit/auto-lock.test.ts` with **failing** tests for the not-yet-written accessor: a deadline while unlocked, null while locked, that reading never extends it, and that a once-a-second poll does **not** register as activity. Principle IV — `auto-lock.ts` is session lifecycle, so the tests are written and reviewed before the code
- [X] T029 [US2] Add `getLockAt(): number | null` to `frontend/src/vault/auto-lock.ts` — record `lockAt` in the existing `reset()`, null on the locked early return. Ceiling, clamping, activity events and visibility handler untouched. T028 must go green
- [X] T030 [US2] Add `frontend/src/features/shell/LockCountdown.tsx` polling `getLockAt()` once a second, rendering `Locks in mm:ss`, returning null when locked, switching treatment under 60s, with `role="timer"` and `aria-live="off"` (CHK026)
- [X] T031 [US2] Verify the vault still locks on schedule with the countdown running and every pane becomes unreachable in the same tick, per `specs/002-vault-workbench-redesign/quickstart.md` V2 and V6 (FR-008, FR-009)

**Checkpoint**: **[Steps 2 and 6 complete — stop for review.]** US2 fully functional and
independently testable.

---

## Phase 4: User Story 1 — Find and read a secret without scrolling (Priority: P1) 🎯 MVP

**Goal**: One line per secret, with fields, custom fields, filing and tagging in a detail pane.

**Independent Test**: Store 24 secrets across several types. The full list is scannable without
scrolling at 1440×900; selecting a row shows that secret's fields beside the list; reveal, copy,
file and tag all behave exactly as today.

### Implementation — the split **[Step 3]**

- [X] T032 [US1] Carry `updatedAt` from `SecretRecord` into `DecryptedSecret` in `frontend/src/features/vault-list/SecretList.tsx` — the value already arrives and is discarded (research §6)
- [X] T033 [US1] Reduce `frontend/src/features/vault-list/SecretList.tsx` to a container: fetching, decryption, search hits, mutations, and `selectedSecretId`. Filter state is owned by `App` from T021a and arrives as props
- [X] T034 [US1] Derive the selected secret from the visible list rather than storing it — `visible.find(s => s.id === selectedSecretId) ?? null` — so a filtered or deleted secret cannot leave a stale pane (FR-017, data-model.md)
- [X] T035 [US1] Add `frontend/src/features/vault-list/SecretListColumn.tsx` — search, count line, rows, "New secret". No field value in any row beyond the single summary value, and never a sensitive one (FR-014)
- [X] T036 [US1] Implement the row: tinted avatar via `template-tint.ts`, title, summary line (`template.name · folderName · first non-sensitive value`, plus `· matched in {x}`), and quick copy — applying the T001/T002 decisions
- [X] T037 [US1] Restyle `frontend/src/features/search/SearchBar.tsx` as a pill with a `/` key badge marked `aria-hidden`, keeping the 120ms debounce, `/`-to-focus and Escape-to-clear (FR-005, CHK027)
- [X] T038 [US1] Replace the per-template button row with one "New secret" pill in `frontend/src/features/vault-list/SecretListColumn.tsx`, opening the template choice in the detail pane (FR-018)
- [X] T039 [US1] Add `frontend/src/features/secret-detail/SecretDetail.tsx` — header chips, title, Edit and Delete, field rows ordered by `field.order`, empty prompt when nothing is selected (FR-015, FR-016)
- [X] T040 [US1] Move folder filing and tag toggling out of list rows into `frontend/src/features/secret-detail/SecretDetail.tsx`, reusing the existing `file` and `toggleTag` calls (FR-015)
- [X] T041 [US1] Restyle `frontend/src/features/secret-detail/CustomFields.tsx` as detail rows under a "Your own fields" heading, rendered only when `custom.length > 0`
- [X] T042 [US1] Add the footer to `frontend/src/features/secret-detail/SecretDetail.tsx`: `Revision {revision} · encrypted under key v{keyVersion} · {relative updated}`, plus "Only you" for a personal vault and **nothing** for a shared one (FR-030c)
- [X] T043 [US1] Render the concurrency refusal verbatim above the form in `frontend/src/features/secret-detail/SecretDetail.tsx` (FR-011)
- [X] T044 [US1] Hide New secret, Edit, Delete, filing and tagging from the DOM when `cached` in `frontend/src/features/vault-list/SecretListColumn.tsx` and `frontend/src/features/secret-detail/SecretDetail.tsx`, keeping the not-queued explanation verbatim (FR-007)
- [X] T045 [US1] Specify and implement the keyboard model for list rows in `frontend/src/features/vault-list/SecretListColumn.tsx`, including where focus lands after selection (CHK024, CHK025)
- [X] T046 [US1] Place the `Decrypting…` loading state within the three-pane layout in `frontend/src/features/vault-list/SecretList.tsx` (CHK003)

### Implementation — icon buttons **[Step 4]**

- [X] T047 [P] [US1] Restyle `frontend/src/components/SensitiveField.tsx` as a 32px round `eye`/`eye-off` icon button. Behaviour and `aria-label`s unchanged
- [X] T048 [P] [US1] Restyle `frontend/src/components/CopyButton.tsx` as a 32px round `copy` icon button, with the acknowledgement moved out of the inline row. Behaviour and `aria-label` unchanged
- [X] T049 [US1] Re-run `frontend/tests/unit/sensitive-field.test.tsx` and `frontend/tests/unit/copy-button.test.tsx` unchanged and confirm both still pass, per `specs/002-vault-workbench-redesign/quickstart.md` V4. **If either needed editing to pass, the restyle changed behaviour**
- [X] T050 [US1] Resolve the 32px icon button against the ≥44px narrow-width requirement in `frontend/src/theme.css`, `frontend/src/components/SensitiveField.tsx` and `frontend/src/components/CopyButton.tsx` — 32px on pointer devices, ≥44px at narrow widths (CHK016)
- [X] T051 [US1] Verify `specs/002-vault-workbench-redesign/quickstart.md` V3 with a 24-secret vault: one line each, all visible without scrolling, reveal re-masks after 30s, clipboard acknowledgements verbatim, selection clears when filtered away

**Checkpoint**: **[Steps 3 and 4 complete — stop for review.]** The largest win is delivered.
US1 independently testable.

---

## Phase 5: User Story 3 — Do one account task at a time (Priority: P2)

**Goal**: Six stacked settings sections become six panels behind an index.

**Independent Test**: Open settings; exactly one task is on screen, all six are reachable, each
behaves as today, and verification remains a banner.

### Implementation **[Step 5]**

- [X] T052 [US3] Add `settingsPanel` state and the two-pane settings frame to `frontend/src/App.tsx`, defaulting to `'password'` and resetting on each entry to settings (data-model.md)
- [X] T053 [US3] Build the settings index rail in `frontend/src/App.tsx` — back row, "Account" heading, six pill rows with icons
- [X] T054 [US3] Render index badges in `frontend/src/App.tsx` only from loaded state — `backupCodesRemaining`, `isOfflineEnabled()`, the failure count `SignInHistory` computes — and nothing when unloaded (FR-030)
- [X] T055 [P] [US3] Give `frontend/src/features/settings/ChangePassword.tsx` the pane treatment, with the warning box and both paragraphs verbatim
- [X] T056 [P] [US3] Restyle `frontend/src/components/StrengthMeter.tsx` as five 5px pill segments, keeping its existing five bands, labels, `problems`/`suggestions` lines and the submit disabling on `!strength.acceptable`
- [X] T057 [P] [US3] Give `frontend/src/features/settings/TwoFactor.tsx` the pane treatment
- [X] T058 [P] [US3] Give `frontend/src/features/templates/TemplateEditor.tsx` the pane treatment
- [X] T059 [P] [US3] Give `frontend/src/features/settings/backup.tsx` the pane treatment, keeping the labelled file input
- [X] T060 [P] [US3] Give `frontend/src/features/settings/OfflineAccess.tsx` the pane treatment
- [X] T061 [P] [US3] Give `frontend/src/features/settings/SignInHistory.tsx` the pane treatment
- [X] T062 [US3] Confirm `VerifyBanner` still renders from `App.tsx` as a notice and did not become a panel — quickstart V5

**Checkpoint**: **[Step 5 complete — stop for review.]**

---

## Phase 6: User Story 4 — Complete every task on a phone (Priority: P2)

**Goal**: Three panes become three levels of one stack at ≤640px, with nothing hidden.

**Independent Test**: At 360×760, every primary task completes with no horizontal scroll and no
target under 44px.

### Implementation **[Step 8, first half]**

- [X] T063 [US4] Implement the ≤640px stack in `frontend/src/App.tsx` — rail contents to a top bar, filter chips under the search pill, folders and tags as a sheet
- [X] T064 [US4] Make list rows cards at ≤640px with a 44px round copy button in `frontend/src/features/vault-list/SecretListColumn.tsx`, and push `SecretDetail.tsx` full-screen with a back row on selection
- [X] T065 [US4] Add the bottom bar — Secrets, Organise, a plus circle, Sharing, Account — in `frontend/src/App.tsx`
- [X] T066 [US4] Resolve the layout band between 640px and ~900px in `frontend/src/theme.css` and `frontend/src/App.tsx`, where rail 262px + list 352px leaves the detail pane near zero (CHK007)
- [X] T067 [US4] Add a Playwright assertion in `frontend/tests/e2e/a11y.spec.ts` measuring the **rendered height** of every interactive element at 360px, failing under 44px — the current stylesheet set 36px and no test has ever measured it (CHK029, research §8)
- [X] T067a [US4] Extend the Playwright assertion in `frontend/tests/e2e/a11y.spec.ts` to measure **computed** `font-size` on every text-bearing element, failing anything below 11.5px, or below 12.5px for interactive text. Computed, not authored — a `rem` inherits and an `em` compounds, so the stylesheet cannot answer this (FR-029)
- [X] T068 [US4] Run `pnpm --filter frontend exec playwright test --project=mobile-360` and the two DOM checks in quickstart V8; both offender lists must be empty

**Checkpoint**: **[Step 8 first half complete — stop for review.]**

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The screens the reference does not draw, then the full sweep. **[Steps 7 and 8]**

### Undrawn screens — component vocabulary only, no new components or colours

- [X] T069 [P] Restyle `frontend/src/features/unlock/Unlock.tsx` as the split card — 560×640, sage left panel, pill inputs, existing copy and the `busy` label unchanged
- [X] T070 [P] Restyle `frontend/src/features/register/Register.tsx` with the `.column` treatment, no-recovery warning verbatim
- [X] T071 [P] Restyle the forgotten-password screen with the `.column` treatment
- [X] T072 [P] Restyle `frontend/src/features/unlock/TotpStep.tsx` with the `.column` treatment
- [X] T073 [P] Restyle `VerifyLanding` in `frontend/src/features/settings/VerifyEmail.tsx` with the `.column` treatment
- [X] T074 [P] Restyle `ReauthPrompt` in `frontend/src/App.tsx` with the `.column` treatment
- [X] T075 [P] Restyle `frontend/src/features/templates/TemplateForm.tsx` with pill inputs and the primary button
- [X] T076 [P] Restyle `frontend/src/features/templates/ChangeWarning.tsx` as a notice, copy verbatim
- [X] T077 [P] Restyle `frontend/src/features/organise/Organise.tsx` with the pane treatment
- [X] T078 [P] Restyle `frontend/src/features/sharing/Sharing.tsx` with the pane treatment
- [X] T079 [P] Restyle `frontend/src/features/secret-detail/DeleteDialog.tsx` per the dialog vocabulary, keeping its copy and the named secret
- [X] T080 Restyle the folder-disposition dialog in `frontend/src/features/organise/Organise.tsx`, keeping its copy and **no pre-selected default** (FR-012)

### Test and verification sweep

- [X] T081 Update the selectors in `frontend/tests/e2e/vault.spec.ts` — "Close settings" → "Back to the vault", and the per-template buttons → "New secret". **No behavioural assertion may be removed** (FR-032)
- [X] T082 Update the selectors in `frontend/tests/e2e/a11y.spec.ts` and `frontend/tests/e2e/helpers.ts`
- [X] T083 Confirm the offline read path end to end per `specs/002-vault-workbench-redesign/quickstart.md` V10: cached vault opens, notice shows, New/Edit/Delete/filing/tagging absent, and headings render in Caprasimo rather than a fallback
- [X] T084 Add a `prefers-reduced-motion` rule to `frontend/src/theme.css` disabling the 120ms transitions (CHK028)
- [X] T084a [P] Verify FR-024 in `frontend/src/`: transitions name only `background`, `background-color`, `box-shadow` or `color`; no `transition: all`; nothing transitions `transform`, `top`, `left`, `width` or `height`; and no `@keyframes` entrance animation exists. `grep -rnE "transition|@keyframes" frontend/src/`
- [X] T085 Verify no user-facing string changed except those recorded as permitted: diff extracted strings in `frontend/src/` against `git show main:frontend/src/` (FR-002, SC-005, CHK030)
- [X] T086 Verify the Principle I gate: `git diff --name-only` shows no file under `frontend/src/crypto/`, `frontend/src/vault/keyring.ts`, `frontend/src/vault/session.ts`, `shared/`, or `backend/`
- [X] T087 Run the full sweep — `pnpm -r typecheck`, `pnpm lint`, `pnpm -r build`, `pnpm -r test`, `pnpm --filter frontend exec playwright test` — quickstart V9
- [X] T088 Walk `contracts/preserved-behaviour.md` item by item and tick each one off against the built result (SC-003)

**Checkpoint**: **[Steps 7 and 8 complete.]** Redesign done.

---

## Dependencies & Execution Order

### Phase order

Phase 0 (decisions) → Phase 1 (setup) → Phase 2 (foundational) → Phase 3 (US2) → Phase 4 (US1) →
Phase 5 (US3) → Phase 6 (US4) → Phase 7 (polish).

### Blocking relationships

- **T002–T003 block T036** — the row summary and quick-copy behaviour are decisions the row
  encodes; there is no default for either.
- **T001 does not block.** The contrast default in spec.md is buildable now; T001 confirms or
  overrides it, and either way the change is one token.
- **T009–T012 block everything in Phases 3–7.** Principle IV: characterisation tests must pass
  against unmodified code first.
- **T013 blocks all restyling** — every later task reads the new tokens.
- **T017 blocks T036** — the tint function before the row that uses it.
- **T019 blocks T020–T027** — the shell before the rail inside it.
- **T021a blocks T022** — the rail cannot render filter state it has not been given.
- **T023 blocks T024** — move the exported types out before deleting the component.
- **T028 blocks T029** — the failing tests before the accessor (Principle IV).
- **T029 blocks T030** — the accessor before its consumer.
- **T033–T034 block T035, T039** — the container's shape before the panes it renders.
- **T047, T048 block T049** — restyle before re-running the pinned tests.
- **US3, US4 and Phase 7 depend on Phase 2 only**, not on US1 or US2.

### User story independence

- **US2 (Phase 3)** — testable alone: navigation and filtering from the rail, with the old list
  still in place below it.
- **US1 (Phase 4)** — testable alone, but its panes need the shell from T019. Delivered together,
  US2 + US1 are the MVP.
- **US3 (Phase 5)** and **US4 (Phase 6)** — independent of one another and of US1/US2.

### Parallel opportunities

- **Phase 0**: T001, T002, T003 in parallel — three independent decisions.
- **Phase 1**: T006, T007 in parallel.
- **Phase 2**: T009, T010, T011 in parallel (three files); then T015, T016, T017 in parallel.
- **Phase 3**: largely serial — T019 gates the rail, T021a gates T022, T028 gates T029 gates T030.
- **Phase 4**: T047 and T048 in parallel — different components, same pattern.
- **Phase 5**: T055–T061 in parallel — seven independent settings components.
- **Phase 6**: serial — each layout step builds on the last.
- **Phase 7**: T069–T079 in parallel — eleven independent screens.

Phase 7's restyling is the largest parallel block: eleven files, no shared state, one vocabulary.

---

## Implementation Strategy

### MVP

**Phases 0–4** — decisions, setup, foundation, the rail, and the list/detail split. That is the
whole of the value: a scannable list with a detail pane, inside a shell that holds navigation in
one place. Phases 5–7 are worth doing and are not what the redesign is for.

### Incremental delivery

Each phase checkpoint is a reviewable stopping point, matching the eight-step order. The
application is usable at every checkpoint — the legacy token aliases keep not-yet-rewritten
components working from T013 onward, so a half-finished redesign is warm and coherent rather than
broken.

### The two things most likely to go wrong

1. **A preserved behaviour quietly stops working while the interface looks correct.** A mask
   width, a 30-second timer, a clipboard clear. This is what T009–T012 and T049 exist for, and
   why they are written before the code changes rather than after.
2. **The countdown keeps the vault unlocked.** `reset()` is bound to five activity events; a
   countdown implemented carelessly could fire one. T029 pins it.
