---
description: "Task list for the Cairn Rebrand"
---

# Tasks: Cairn Rebrand

**Input**: Design documents from `/specs/003-cairn-rebrand/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Three test tasks, and only three. T003 is **mandatory** — Constitution Principle IV,
because the second-factor issuer sits next to a security-critical path and a test written after
the change proves nothing about preservation. T005 pins the mark's variant boundaries, which are
behaviour rather than appearance. T012 updates the one existing assertion that names the product.
Nothing else here can fail in a way a user would not immediately see.

**Organization**: Grouped by user story. Each phase ends at a point where the work is coherent and
reviewable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: Which user story the task serves (US1–US3)
- Every task names its exact file path

## Path Conventions

`frontend/` and one file in `backend/`. **No file under `frontend/src/crypto/` other than
`totp.ts`, and no file under `frontend/src/vault/`, `shared/`, or any backend route handler may
appear in this feature's diff.** `totp.ts` changes one default string and nothing else — verify
with `git diff --stat` before merging.

---

## Phase 1: Setup — the assets

**Purpose**: get the supplied files into the project, verified, before anything references them.

- [X] T001 [P] Copy `favicon.svg`, `favicon-16.png`, `favicon-32.png`, `apple-touch-icon-180.png`, `icon-192.png`, `icon-512.png` and `icon-maskable-512.png` from `design_handoff_vault_workbench/brand/` into `frontend/public/`, overwriting the three that already exist
- [X] T002 [P] Confirm `icon-512-sage.png` and `app-icon-512-sage.svg` were **not** copied — the handoff supplies them and assigns them no use, and an asset nothing references is a question every later reader has to re-ask (FR-013a)
- [X] T003 Verify each copied file's pixel dimensions match its filename, and that the mark in `frontend/public/icon-maskable-512.png` sits wholly inside the 80% safe circle (FR-013, quickstart V4)

**Checkpoint**: assets in place and verified. Nothing references them yet, so nothing can be broken.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the one security-adjacent guarantee, and the component two stories depend on.

**⚠️ T004 and T005 must pass against unmodified source before any renaming begins.**

- [X] T004 Add `frontend/tests/unit/totp-issuer.test.ts` pinning that an `otpauth://` URI built with one issuer and a code verified against that enrolment's secret are independent — the issuer is a label, never an input to verification (FR-004, Constitution IV, quickstart V0)
- [X] T005 Run T004 against the **unmodified** `frontend/src/crypto/totp.ts` and confirm it passes. If it fails, the issuer participates in verification after all and FR-004's promise is unfounded — stop and re-plan rather than renaming
- [X] T006 Add `frontend/tests/unit/mark.test.tsx` — **failing** — pinning variant selection at the exact boundaries (19 → two stones, 20 → three, 31 → three, 32 → four), that every shape inherits `currentColor`, and that the mark is `aria-hidden`
- [X] T007 Add `frontend/src/components/Mark.tsx` with the three variants transcribed from [contracts/mark-component.md](./contracts/mark-component.md). **Transcribe the geometry, never import the SVGs** — 94% of each file is C2PA provenance metadata, and inlining them verbatim puts ~23 KB of base64 into a component that renders on every screen (research §1). T006 must go green
- [X] T008 Confirm the `cx` values are exactly 24, 23, 25, 23 in the full variant. They are deliberately off-centre and FR-011 forbids centring them; a tidy-up here is a silent change to the brand

**Checkpoint**: **stop for review.** The issuer guarantee is evidenced, and the mark exists and is
pinned. Nothing user-visible has changed yet.

---

## Phase 3: User Story 1 — Recognise the app before opening it (Priority: P1) 🎯 MVP

**Goal**: the product has a name and a mark wherever someone meets it before opening it — the tab,
the home screen, the installed app — and the shell stops flashing a colour from a deleted theme.

**Independent Test**: open the app and confirm the tab reads Cairn and carries the mark; install it
and confirm the home-screen name and icon match, unclipped. Delivered alone, the product is named.

- [X] T009 [US1] Update `frontend/index.html`: `<title>` to `Cairn`, `theme-color` from `#12141a` to `#c67139`, repoint `apple-touch-icon` from `/icon-192.png` to `/apple-touch-icon-180.png`, and add the two icon links it has never had — `/favicon.svg` and `/favicon-32.png` (FR-002, FR-012, FR-014)
- [X] T010 [P] [US1] Update `frontend/public/manifest.webmanifest`: `name` and `short_name` to `Cairn` (dropping `Vault` — the mark does that job now), `theme_color` to `#c67139`, `background_color` to `#f5ead8`. Leave `description` exactly as it is (FR-005)
- [X] T011 [P] [US1] Rename the exported backup in `frontend/src/features/settings/backup.tsx` from `vault-backup-<date>.json` to `cairn-backup-<date>.json`. Import reads the file's contents and never its name, so a backup taken under the old name must still restore (FR-002a)
- [X] T012 [US1] Replace the brand row in `frontend/src/features/shell/VaultRail.tsx` with the lockup from [contracts/mark-component.md](./contracts/mark-component.md) — a 34px terracotta tile, radius 11, holding the mark at 20px in `var(--color-bg)`, with `Cairn` beside it at 19px in the heading face. Remove the now-unused `Shield` import (FR-010)
- [X] T013 [US1] Update the assertion in `frontend/tests/unit/vault-rail.test.tsx` that expects `Password Manager`, keeping its shape including the negative assertion. This is the only pre-existing test that names the product
- [X] T014 [US1] Verify quickstart V1 and V3: the tab, rail and downloaded filename all say Cairn, and neither browser chrome nor the installed splash shows a dark colour at any point

**Checkpoint**: **stop for review.** The product is named. This is the whole of the value.

---

## Phase 4: User Story 2 — Read the mark at every size (Priority: P2)

**Goal**: the mark stays legible from a 16px favicon to a 512px app icon, losing stones rather than
detail.

**Independent Test**: render at 16, 20, 24, 32, 64 and 512px and confirm each is distinct, with the
stone count stepping down rather than the stones merely shrinking.

**Why after US1**: the component is already built and unit-pinned in Phase 2. What remains is
confirming it holds in the real surfaces US1 introduced — a browser tab, an installed icon, a rail.

- [X] T015 [US2] Verify quickstart V2: render the mark at 16, 20, 24, 32, 64 and 512px and confirm each is distinct and unsmudged, and that two, three and four stones appear at the specified thresholds (SC-002)
- [X] T016 [US2] Confirm the mark reads correctly in both places it is coloured by its surroundings — cream on the rail's terracotta tile, and terracotta on the cream ground — since one asset serves both (FR-007)
- [X] T017 [US2] Install to a platform that masks icons to a circle and confirm no stone is clipped (SC-003, quickstart V4)

**Checkpoint**: the mark is proven at every size it actually appears.

---

## Phase 5: User Story 3 — Mail and the second factor name the product (Priority: P3)

**Goal**: what the application sends, and what it writes into an authenticator app, identify Cairn.

**Independent Test**: inspect an outbound message's display name; enrol a new second factor and read
its label in the authenticator app.

- [X] T018 [P] [US3] Change the issuer default in `frontend/src/crypto/totp.ts` from `Password Manager` to `Cairn` — one line. T004 must still pass unchanged (FR-004)
- [X] T019 [P] [US3] Change the `From` display name in `backend/src/modules/activity/mailer.ts` to `Cairn`. Leave the `no-reply@passwordmanager.local` address alone: it is not user-visible today and gets replaced wholesale when a real mail provider is configured (spec discrepancy 7)
- [X] T020 [US3] Leave `frontend/tests/crypto/totp.test.ts` **untouched**. It passes `issuer` explicitly and asserts `issuer=Password%20Manager`, so it pins percent-encoding of a name containing a space, not the product name. Changing it to `Cairn` would silently delete the encoding case it exists to cover (research §4)
- [X] T021 [US3] Verify quickstart V5 end to end: enrol a second factor **before** deploying the rename, deploy, then verify with the same authenticator entry. It still reads the old label — that is correct, not a defect — and it must still verify (SC-006)

**Checkpoint**: every surface that outlives a session now names the product, and nothing that was already enrolled broke.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T022 Verify SC-001: build, then `grep -ri "password manager" frontend/dist/` returns nothing. Any hit outside the exclusions in [contracts/brand-surfaces.md](./contracts/brand-surfaces.md) is a missed surface
- [X] T023 Verify the out-of-scope list was honoured: `frontend/package.json` still names `frontend`, `render.yaml` still names `safe-pass`, the database name and env-var names are unchanged, and `README.md` and the constitution are untouched (FR-003, FR-015)
- [X] T024 Verify quickstart V6: load and store a secret **before** deploying, deploy, reload, accept the update prompt, and confirm the rebrand arrives with the stored secret intact and no re-authentication. Then reload with the network off and confirm the vault still opens — the icon swap must not disturb the precache (FR-018, SC-007)
- [X] T025 Verify SC-006a: a backup exported before the rename still restores after it, with every secret, folder and tag intact
- [X] T026 Run the full sweep — `pnpm -r typecheck`, `pnpm lint`, `pnpm -r build`, `pnpm -r test`, `pnpm --filter frontend exec playwright test` — and confirm exactly one pre-existing assertion changed (T013) plus the two new test files, with no behavioural assertion removed or weakened (SC-005, quickstart V7)
- [X] T027 Confirm the Principle I gate: `git diff --name-only` shows no file under `frontend/src/vault/`, `shared/`, or any backend route handler, and that `frontend/src/crypto/totp.ts` differs by exactly one string
- [X] T028 Verify FR-009: `grep -rn "cairn-mark\|<ellipse" frontend/src` returns hits in `frontend/src/components/Mark.tsx` and nowhere else. The mark's geometry living in exactly one module is the kind of rule that erodes a file at a time, so it is checked rather than trusted
- [X] T029 Record the trademark position in `specs/003-cairn-rebrand/spec.md` under FR-001 — either that clearance for classes 9 and 42 is confirmed, or that it is outstanding and what remains. **This does not gate the work** (FR-001a): the deploy to the existing unlisted address proceeds either way. It gates publication, and SC-008 requires the answer to be written down somewhere rather than carried in someone's memory

---

## Dependencies & Execution Order

### Phase order

Phase 1 (assets) → Phase 2 (foundational) → Phase 3 (US1) → Phase 4 (US2) → Phase 5 (US3) →
Phase 6 (polish).

### Blocking relationships

- **T004 blocks T018.** The issuer test is written and passing against unmodified code before the
  default changes. A test written afterwards passes by construction and evidences nothing.
- **T006 blocks T007** — the failing test before the component.
- **T007 blocks T012.** The rail lockup renders the mark; the component must exist first.
- **T001 blocks T009 and T010** — the icons must be in `public/` before anything links to them.
- **T009 and T010 both touch icon references** but are different files, so they parallelise.
- **T012 blocks T013** — update the assertion against the component as built, not as imagined.
- **Phase 4 depends on Phase 3**, because it verifies the mark in the surfaces US1 creates.
- **Phase 5 depends on nothing in Phases 3–4.** It could ship first; it is last because it is the
  least visible and, with mail inert, the least verifiable.

### Parallel opportunities

- **Phase 1**: T001 and T002 together.
- **Phase 2**: none — T004 gates T005, T006 gates T007. Serial by design.
- **Phase 3**: T010 and T011 alongside T009 — three different files.
- **Phase 5**: T018 and T019 together — one frontend file, one backend file.

The feature is small enough that parallelism saves little. The ordering exists to keep each
checkpoint reviewable, not to compress a schedule.

---

## Implementation Strategy

### MVP

**Phases 1–3.** The assets, the mark, and the name wherever someone meets the product before
opening it. That is what a name is for; Phases 4–6 confirm and complete it.

### Incremental delivery

Every checkpoint is a working application. The riskiest change — the issuer, next to a security
path — is evidenced in Phase 2 before anything is renamed, and applied in Phase 5 once everything
else is known good.

### The two things most likely to go wrong

1. **The mark's SVGs get imported rather than transcribed.** It is the obvious reading of "inline
   the marks", and it silently adds ~23 KB of provenance metadata to a component on every screen.
   T007 says it; research §1 measures it.
2. **A returning visitor never sees the rebrand.** The service worker updates by prompt, not
   silently, so a cached copy keeps the old name and icons until the user accepts. That is the
   application's deliberate update path and T024 verifies it works — but anyone checking the
   deploy on a browser they have used before should hard-reload before concluding it failed.

### Deliberately not done

- **The deployed service keeps its name** (FR-015). Renaming breaks every bookmark and sent link
  to change a string no user reads.
- **The sage icon variant is not shipped** (FR-013a).
- **Obtaining trademark clearance** is not a task here: FR-001 gates publication — an app store, a
  purchased domain, print, or an announcement — not this work, and not the deploy to the existing
  unlisted address (FR-001a). T029 records the *position*, which is what SC-008 asks for; it does
  not wait for an answer.
