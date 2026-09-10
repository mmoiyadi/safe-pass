# Feature Specification: Cairn Rebrand

**Feature Branch**: `003-cairn-rebrand`
**Created**: 2026-09-10
**Status**: Draft
**Input**: Brand handoff at `design_handoff_vault_workbench/brand/` — `BRAND.md` (the specification) plus four vector marks, three icon masters, and seven raster icons.

## Overview

The application has never had a name. It calls itself **"Password Manager"** in the browser tab, the installed-app manifest and the rail; `safe-pass` appears only in deploy configuration and is not visible to any user. This gives the product a name — **Cairn** — a mark, and a shell that stops flashing near-black before a cream page paints.

Three things change, and nothing else:

1. **The name**, wherever a user can read it: the tab title, the installed app, the rail, and the display name on outbound mail.
2. **The mark**, as an inline component with four size variants, plus replacement icons for the browser tab, the home screen and the installed app.
3. **The shell colours**, which still carry `#12141a` from a dark theme that no longer exists — it tints browser chrome nearly black against a cream page and makes the installed app flash dark before it paints.

No capability is added or removed, and no vault behaviour changes. This is naming and painting.

**This supersedes FR-022a of the vault workbench redesign**, which required the rail to read "Password Manager" and explicitly declined to introduce a brand. That requirement existed because naming a product is not a visual decision and was out of scope for a presentation redesign. It is the scope of this one.

## ⚠️ Trademark clearance is a precondition, not a task

The handoff records that **Cairn Security (cairn-security.com) is an active cybersecurity company in an adjacent segment**, and that its author could not reach a trademark register to check classes 9 and 42.

Nothing bearing the name may be **published** until that is cleared — listed in an app store, attached to a purchased domain, printed, or named in any public announcement. Renaming a shipped password manager costs vastly more than the search does. This is recorded as **FR-001** because it gates the work rather than following it.

Building, merging and deploying to the existing unlisted address are **not** publication and do not wait (FR-001a). The address is not advertised and serves the people building the product; blocking it would stall the work on a lawyer's schedule while creating none of the exposure that matters. The gate applies to that address from the moment it is ever announced or linked publicly.

### Trademark position — recorded 2026-09-10 (T029, SC-008)

**Status: OUTSTANDING.** No register has been consulted. This is written down rather than
carried in anybody's memory, which is the whole of what SC-008 asks for.

What is known: **Cairn Security** (cairn-security.com) trades as a cybersecurity company, an
adjacent segment. The handoff's author could not reach a register to check **classes 9**
(software) and **42** (SaaS and technical services).

What remains: a search of classes 9 and 42 in the jurisdictions the product would be offered in,
and a decision on whether to proceed under this name.

**This does not block the work.** Under FR-001a the build, the merge and the deploy to the
existing unlisted address all proceed. It blocks **publication** — an app-store listing, a
purchased domain, print, or a public announcement. Revisit before any of those, and update the
status above rather than adding a second record.

## Clarifications

### Session 2026-09-10

- Q: Does deploying the rebrand to the existing public Render URL count as "publication" under the trademark precondition? → A: No. Publication means app stores, a purchased domain, printed material, and any public announcement or listing. Deploying to the existing unlisted URL is development use and proceeds without waiting on clearance.
- Q: Should the deployed service be renamed from `safe-pass` to `cairn`, given that changes the public address? → A: No. The service name is deploy plumbing that no user reads; the address stays as it is. Revisit only if a real domain is bought, when the address changes anyway.
- Q: What is the sage-coloured icon variant for? → A: Nothing, for now. Ship only the terracotta icons the manifest specifies; the sage files stay in the handoff folder as source material rather than entering the project unreferenced.
- Q: Should the exported backup file be renamed to carry the product name? → A: Yes — `cairn-backup-<date>.json`. Import reads the file's contents and never its name, so backups taken under the old name still restore.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recognise the app before opening it (Priority: P1)

A person with several tabs open, or a phone full of icons, finds this application by its name and its mark rather than by reading a generic label that half their other tools could also carry.

**Why this priority**: This is the whole of what a name is for. Everything else in this feature supports it.

**Independent Test**: Open the app in a tab and confirm the title reads "Cairn" and the tab icon is the mark. Install it and confirm the home-screen name and icon match. Delivered alone, the product is named.

**Acceptance Scenarios**:

1. **Given** the application is open, **When** the browser tab is read, **Then** it shows "Cairn" and the cairn mark, not "Password Manager" and not a generic icon.
2. **Given** the application is installed to a home screen, **When** the icon and label are read, **Then** both show Cairn, and the mark is not clipped by the platform's icon mask.
3. **Given** the unlocked vault, **When** the rail is read, **Then** the brand row shows the mark in a terracotta tile beside the word "Cairn".
4. **Given** an installed application is launched, **When** it starts, **Then** the splash and browser chrome are the product's own colours, not the near-black of a theme that no longer exists.

---

### User Story 2 - Read the mark at every size it appears (Priority: P2)

The mark stays legible from a 16-pixel favicon to a 512-pixel app icon, losing stones rather than detail as it shrinks.

**Why this priority**: A mark that turns to mud at 16px is worse than no mark, because it appears in the one place a user scans fastest.

**Independent Test**: Render the mark at 16, 20, 24, 32, 64 and 512 pixels and confirm each is distinct and unsmudged, and that the stone count steps down as specified rather than the stones simply shrinking.

**Acceptance Scenarios**:

1. **Given** a size below 20 pixels, **When** the mark renders, **Then** it shows two stones.
2. **Given** a size from 20 up to 32 pixels, **When** the mark renders, **Then** it shows three stones.
3. **Given** a size of 32 pixels or more, **When** the mark renders, **Then** it shows the full mark with alternating stone weights.
4. **Given** the mark anywhere in the interface, **When** its colour is inspected, **Then** it takes its colour from its surroundings rather than carrying one of its own.

---

### User Story 3 - Receive mail that names the product (Priority: P3)

Mail the application sends identifies itself as Cairn, so a verification or security notice is recognisable rather than looking like one of a thousand unnamed services.

**Why this priority**: Real, but mail does not currently send at all — the mailer is a local-catcher stub with no TLS and no authentication. The naming is a one-line change that must not be forgotten when mail is made to work.

**Independent Test**: Inspect an outbound message and confirm the display name reads Cairn.

**Acceptance Scenarios**:

1. **Given** the application sends a message, **When** its display name is read, **Then** it names Cairn.
2. **Given** a person enrolling a second factor, **When** the entry appears in their authenticator app, **Then** it is labelled Cairn.

---

### Edge Cases

- **An authenticator entry enrolled before the rename** keeps its old label. Verification does not depend on the issuer, so an existing second factor must keep working untouched; only new enrolments carry the new name.
- **A returning visitor holding a cached copy of the application** will see the old name and icons until their copy updates. The rebrand must not require them to lose data or re-authenticate to see it.
- **A platform that masks icons into a circle** must not clip a stone.
- **The mark on a dark surface, and on the terracotta tile** must remain legible in both, since it takes its colour from its surroundings.
- **A locale or font-loading state where the display face is unavailable** must still render the name readably in the fallback face rather than as a blank or a broken glyph.
- **The deployed service's public address** is derived from its name. Changing the name changes the address, which invalidates the links in any mail already sent and any bookmark a user holds.

## Requirements *(mandatory)*

### Functional Requirements

#### Precondition

- **FR-001**: Trademark clearance for the name in the relevant classes MUST be confirmed before the name is **published**. Published means: listed in an app store, attached to a purchased domain, printed, or named in any public announcement or directory entry.
- **FR-001a**: Deploying to the existing unlisted deployment URL is **not** publication and MUST NOT wait on clearance. The address is not advertised and serves the people building the product, so it creates none of the exposure a register cares about — while blocking it would stall the work on a lawyer's schedule for no protection in return. Should that address ever be announced or linked publicly, FR-001 applies to it from that moment.

#### The name

- **FR-002**: Every place a user can read the product's name MUST read "Cairn": the browser tab, the installed application's name and short name, the rail's brand row, the display name on outbound mail, and the filename of an exported backup.
- **FR-002a**: The exported backup MUST be named for the product — `cairn-backup-<date>.json`. It is among the longest-lived strings the product emits, since it sits in a download folder for years. Renaming it MUST NOT affect restoring: import reads the file's contents and never its name, so a backup taken under the old name MUST still restore unchanged.
- **FR-003**: The name MUST NOT be changed in identifiers that are not product names — workspace package names, database names, environment-variable prefixes, and internal hostnames. Renaming those is a migration, not a rebrand, and carries risk this feature does not accept.
- **FR-004**: The second-factor issuer label MUST name Cairn for new enrolments. Existing enrolments MUST continue to verify unchanged; the rename MUST NOT invalidate a second factor anyone already holds.
- **FR-005**: The installed application's description MUST be left as it stands. It is accurate and this feature has no reason to touch it.

#### The mark

- **FR-006**: The mark MUST be available to the interface as a single component that selects the correct variant for the size it is asked for: two stones below 20 pixels, three from 20 to 32, and the full alternating-weight mark from 32 up.
- **FR-007**: The mark MUST take its colour from its surroundings rather than carrying its own, so one asset serves every surface it appears on.
- **FR-008**: The mark MUST be delivered inline rather than fetched, so that it is present at first paint and costs no request.
- **FR-009**: No part of the interface other than that one component may reference the mark's source files.
- **FR-010**: The rail's brand row MUST show the mark inside a terracotta tile beside the name. This is the only place in the interface that uses the icon form; everywhere else the word alone stands.
- **FR-011**: The mark MUST be reproduced only as specified: solid fill, no outline, gradient, bevel or shadow; scaled squarely and never stretched; clear space on all four sides at least the height of the top stone; and the stones' offsets left exactly as drawn, never centred.

#### The icons

- **FR-012**: The browser-tab, home-screen and installed-application icons MUST be replaced with the supplied set, and the application MUST additionally offer a scalable tab icon and a platform-specific home-screen icon, neither of which it offers today.
- **FR-013**: The masked icon MUST keep the whole mark inside the platform's safe area, so that no stone is clipped by a circular or rounded mask.
- **FR-013a**: Only icons the application actually references MUST be added to it. The handoff supplies a sage-coloured alternate that it never assigns a use to; it MUST NOT be shipped, because an asset nothing reads is a question every later reader has to re-ask and a file every later change has to consider. It stays in the handoff folder as source material, available if a use is ever decided.

#### The shell

- **FR-014**: The colours the browser and the installed application use to paint around the page MUST be the product's own — the accent for chrome, the cream ground behind the splash. The near-black currently carried MUST be removed; it belongs to a theme this product no longer has.

#### Deployment

- **FR-015**: The deployed service MUST keep its current name, and the application's configured public origin MUST be left unchanged. The service name is deploy plumbing that no user ever reads — the same reasoning FR-003 applies to package and database names. Renaming it would break every existing bookmark and every link already sent, to change a string nobody sees.
- **FR-016**: Should a real domain be bought later, the address changes at that point regardless, and the service MAY be renamed in the same change so that one break replaces two. Whenever the service is renamed, the configured public origin MUST be updated in the same change: a rename that leaves the old origin configured produces mail whose links point somewhere that no longer answers — a failure that looks like success.

#### Preservation

- **FR-017**: No vault behaviour, screen, control or message may change. Encryption, authentication, sharing, offline access and every existing capability MUST be untouched.
- **FR-018**: A returning visitor holding a cached copy MUST receive the rebrand through the application's existing update path, without losing stored data, without re-authenticating, and without the offline copy being discarded.

### Key Entities

No new data. The rebrand introduces presentation and configuration only:

- **Product name** — one string, read in four user-visible places.
- **Mark** — one component with three size variants, drawn from the supplied vector sources.
- **Icon set** — the raster and vector files the browser and platforms read.
- **Shell colours** — the two values the browser and installed application paint with.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No user-visible surface names the product anything other than Cairn. Verified by searching the built application and the running interface for the previous name and finding zero results outside internal identifiers FR-003 exempts.
- **SC-002**: The mark renders distinctly at 16, 20, 24, 32, 64 and 512 pixels, showing the specified number of stones at each, with no size at which the stones merge.
- **SC-003**: The installed application shows the mark unclipped on a platform that masks icons to a circle.
- **SC-004**: Neither the browser chrome nor the installed application's splash shows a dark colour at any point during launch.
- **SC-005**: Every existing automated test passes unchanged except where it asserts the product's own name, and no assertion about behaviour is removed or weakened.
- **SC-006**: A second factor enrolled before the rename still verifies after it.
- **SC-006a**: A backup exported before the rename still restores after it, with every secret, folder and tag intact.
- **SC-007**: A returning visitor with a cached copy reaches the rebranded application without losing stored data or signing in again.
- **SC-008**: Trademark clearance is recorded before any public artefact bears the name.

## Assumptions

- **The handoff is the specification**; its `BRAND.md` is authoritative on what changes and the supplied assets are used as given rather than redrawn.
- **The name is settled.** This feature implements "Cairn"; choosing it is not in scope.
- **The supplied assets are correct and complete** — fitted to the mark's bounding box, and the masked variant already inside the safe area. They are used, not re-cut.
- **Self-hosted fonts are already in place.** The handoff's section on fonts describes work completed in the vault workbench redesign; nothing there remains to do.
- **Mail naming is prepared, not proven.** The mailer cannot reach any real provider — no TLS, no authentication — so FR-002's mail clause is verified by inspecting what would be sent, not by receiving it.
- **The deployed service keeps its current name and address** (FR-015). Renaming is deferred to whenever a domain is bought, if ever.
- Discrepancies between the handoff and the codebase are reported rather than guessed at, as in the previous feature.

## Discrepancies found between the handoff and the codebase

Recorded during specification, verified against the source.

1. **The handoff's font section is already done.** It asks for Caprasimo and Figtree to be self-hosted from `public/fonts/` instead of imported from a font CDN. That was completed in the vault workbench redesign, including precaching. Nothing remains.

2. **The handoff does not mention the second-factor issuer.** `frontend/src/crypto/totp.ts` defaults the issuer to "Password Manager", and that string is what an authenticator app displays. It is user-visible and belongs in the rename, so FR-004 covers it — along with the constraint the handoff had no reason to state: the issuer is embedded at enrolment, so existing second factors must keep verifying.

3. **The rail currently reads "Password Manager" because a requirement says it must.** FR-022a of the vault workbench redesign mandates exactly that, on the grounds that naming a product is not a visual decision. This feature supersedes it, and that supersession is stated in the Overview rather than left for a reader to infer from a contradiction.

4. **Renaming the deployed service changes its public address.** The service is reachable at an address derived from its old name, and that address is the origin the application builds mail links from. The handoff asks for the rename and notes the two must change together. **Decided: do not rename (FR-015).** The service name is not a product name — no user reads it — and renaming would break every existing bookmark and sent link to change an invisible string. It is revisited only if a domain is bought, when the address changes anyway.

5. **A sage icon variant is supplied without a use.** `icon-512-sage.png` and `app-icon-512-sage.svg` appear twice in the handoff's asset tables and are never assigned a place. Sage is the palette's second accent, so these are most likely an alternate the author offered without choosing between. **Decided: not shipped (FR-013a)** — the terracotta icons are the ones the manifest specifies.

6. **The backup file carries no product name.** The handoff lists "the backup file header" among the places the word appears. It does not: the export envelope is `formatVersion`, a timestamp, and the vault's data, with nothing identifying the application. So the rebrand poses **no backup-compatibility risk** — but the *download filename* does carry one (`vault-backup-<date>.json`), which the handoff does not mention. FR-002a covers it.

7. **The outbound mail address is `no-reply@passwordmanager.local`.** The handoff asks only about display names and subjects. The local-only address is not user-facing today and is not a product name in the sense FR-003 protects, but it will become visible the moment mail actually sends. Flagged rather than specified, because it is bound up with configuring a real mail provider.
