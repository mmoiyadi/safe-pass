# Implementation Plan: Cairn Rebrand

**Branch**: `003-cairn-rebrand` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-cairn-rebrand/spec.md`

## Summary

Give the product a name, a mark, and a shell painted in its own colours. Nine files change, one
component is added, six icons are copied in, and one test assertion moves. No vault behaviour is
touched — no route, no schema, no crypto, no request shape.

The approach follows the handoff with three corrections research turned up: the mark's geometry is
transcribed rather than its files inlined (94% of each SVG is provenance metadata), the second-
factor issuer is included though the handoff omits it, and the backup **filename** is renamed
though the backup **format** carries no name at all.

Sequenced so the interface change lands last: assets and configuration first, because they can be
verified independently and cannot break a running app; then the component; then the one line that
makes the rail say the new name.

## Technical Context

**Language/Version**: TypeScript 5.6.3, Node 22

**Primary Dependencies**: React 19, Vite 6, `vite-plugin-pwa` 0.21 (`injectManifest` + Workbox 7),
Fastify 5, Prisma 6.1, `lucide-react` 1.42.0

**Storage**: PostgreSQL 17 — **untouched by this feature**. No migration, no schema change.

**Testing**: Vitest 3.2 with `@testing-library/react` 16 (unit), Playwright 1.48 (end-to-end,
four projects including `mobile-360`)

**Target Platform**: Evergreen browsers, plus an installable PWA on Android and iOS

**Project Type**: Web application — `frontend/` + `backend/` + `shared/` in a pnpm workspace

**Performance Goals**: No change. The mark adds roughly 600 bytes of inline SVG to the bundle and
removes one `lucide-react` icon import from the rail.

**Constraints**: Offline-capable (the shell is precached, the vault readable with no network); the
service worker updates by prompt, not silently; every user-visible string is governed by FR-002b
of the previous feature, so a name change is a permitted change and nothing else may ride along.

**Scale/Scope**: Nine files edited, one added, seven assets copied, one assertion updated.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Engaged? | Assessment |
|---|---|---|
| **I. Zero-Knowledge Encryption** | **Yes, narrowly** | One file under `frontend/src/crypto/` **is** modified: `totp.ts`, by exactly one default string — the issuer label written into an `otpauth://` URI at enrolment. No key derivation, no envelope, no primitive, no stored secret, and the issuer is not an input to verification (research §4). Nothing else under `frontend/src/crypto/`, and nothing under `frontend/src/vault/`, `shared/`, or any backend route handler. The one backend file touched is `mailer.ts`, and only its `From` display name. |
| **II. Least-Privilege Access** | No | No authorization path, no sharing logic, no audit-log behaviour. |
| **III. Incremental Delivery With Clarified Requirements** | **Yes** | Four ambiguities were resolved and recorded in the spec before planning: the publication boundary, the service rename, the sage variant, the backup filename. Research resolved six more without asking, each recorded with its evidence. Nothing is left to be decided mid-implementation. |
| **IV. Test-First for Security-Critical Code** | **Partially** | The second-factor issuer is adjacent to a security-critical path, so FR-004's guarantee — *an existing enrolment must keep verifying* — gets a test written before the default changes. Nothing else here is security-critical: a title, an icon and a colour cannot fail silently in a way a user would not see. |
| **V. Schema-Driven Extensibility** | No | No template, field, or type definition changes. |

**Gate: PASS.** Two principles engaged. Principle I is touched narrowly and provably — the change
is a label, and T027 verifies `totp.ts` differs by exactly one string before merge. Principle IV
carries the test-first obligation, and T004 is scheduled before T018 rather than beside it.

### Constitution re-check after Phase 1

**Still PASS.** The design added no data, no persisted state, and no interface between components
beyond one presentational contract. The Principle IV obligation is unchanged and is the first task
in the work order.

*Corrected after `/speckit-analyze` (finding F1): the Principle I row previously claimed no file
under `frontend/src/crypto/` was modified, which is false — `totp.ts` is. The verdict was right and
the evidence was not, and a constitution claim is the last place to be approximate.*

## Project Structure

### Documentation (this feature)

```text
specs/003-cairn-rebrand/
├── plan.md              # This file
├── research.md          # Phase 0 — ten findings, six of them corrections to the handoff
├── data-model.md        # Phase 1 — no persisted data; the constants that carry the brand
├── quickstart.md        # Phase 1 — seven verification scenarios
├── contracts/
│   ├── mark-component.md    # The Mark component's interface and exact geometry
│   └── brand-surfaces.md    # Every surface the name appears on, with before and after
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

Only these paths change. Everything else in the repository is out of scope.

```text
frontend/
├── index.html                              # title, theme-color, three icon links
├── public/
│   ├── manifest.webmanifest                # name, short_name, theme_color, background_color
│   ├── favicon.svg                         # NEW
│   ├── favicon-16.png                      # NEW
│   ├── favicon-32.png                      # NEW
│   ├── apple-touch-icon-180.png            # NEW
│   ├── icon-192.png                        # replaced
│   ├── icon-512.png                        # replaced
│   └── icon-maskable-512.png               # replaced
├── src/
│   ├── components/Mark.tsx                 # NEW — three inline variants, size-selected
│   ├── features/shell/VaultRail.tsx        # the brand lockup
│   ├── features/settings/backup.tsx        # the download filename
│   └── crypto/totp.ts                      # the issuer default (one line)
└── tests/unit/
    ├── mark.test.tsx                       # NEW — variant selection and colour inheritance
    ├── totp-issuer.test.ts                 # NEW — an existing enrolment still verifies
    └── vault-rail.test.tsx                 # one assertion updated

backend/
└── src/modules/activity/mailer.ts          # the From display name
```

**Structure decision**: no new directories, no new dependencies. `Mark.tsx` sits beside `Icon.tsx`
in `components/` because it is the same kind of thing — a presentational primitive with no feature
knowledge. FR-009 requires it to be the only module that knows the mark's shape, which the
placement makes obvious.

## Complexity Tracking

Nothing here needs justifying against the constitution's simplicity rule. Two decisions are worth
recording because a later reader might reasonably expect the opposite:

| Decision | Simpler alternative rejected | Why |
|---|---|---|
| Transcribe the mark's geometry into the component | Import the four SVGs as files | The files are 94% C2PA provenance metadata; importing them either costs four requests (failing FR-008) or embeds ~23 KB of base64 in a component that renders on every screen. Transcription costs ~600 bytes. |
| Three size variants selected at render | One SVG scaled by CSS | The mark is designed to *lose stones* as it shrinks (FR-011). A single scaled asset turns to mud at 16px, which is the size the browser tab uses — the place a user scans fastest. |

Two things were deliberately **not** done, and both are the simpler choice:

- **The deployed service keeps its name** (FR-015). Renaming would break every bookmark and sent
  link to change a string no user reads.
- **The sage icon variant is not shipped** (FR-013a). The handoff supplies it and never assigns it
  a use; an asset nothing references is a question every later reader has to re-ask.
