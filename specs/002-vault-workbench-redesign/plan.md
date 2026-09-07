# Implementation Plan: Vault Workbench Redesign

**Branch**: `002-vault-workbench-redesign` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-vault-workbench-redesign/spec.md`

## Summary

Rearrange and restyle the existing password-manager interface without changing what it can do.
Four stacked navigation strips collapse into one persistent rail; the secret list stops rendering
every field of every secret and gains a detail pane beside it; six stacked settings sections
become six panels behind an index. Everything moves onto the supplied "Organic" token set.

The technical approach is deliberately conservative: **presentation only, with two exceptions**,
both narrow and both named in the spec. Nothing under `frontend/src/crypto/`,
`frontend/src/vault/keyring*`, `shared/`, or `backend/` is touched. The request and response
shapes the client sends and receives are unchanged.

The two exceptions:

1. `frontend/src/vault/auto-lock.ts` gains a read-only accessor for the lock deadline, so the rail
   can display a countdown. The timer, the ceiling and the clamping are untouched.
2. `SecretList`'s decrypt loop stops discarding the `updatedAt` the server already sends, so the
   detail footer can state when a secret last changed. No type or endpoint changes — the field is
   already on `SecretRecord` in `shared/src/api.ts`.

## Technical Context

**Language/Version**: TypeScript 5.6.3 (pinned), targeting ES2023

**Primary Dependencies**: React 19, Vite 6, `vite-plugin-pwa` 0.21 (injectManifest, hand-written
service worker). One dependency is **added**: `lucide-react` for the icon set. Two fonts are
**vendored**: Caprasimo 400 and Figtree 400/500/600/700.

**Storage**: None new. IndexedDB offline cache and the in-memory keyring are untouched.

**Testing**: Vitest 3 + jsdom for unit tests; Playwright for end-to-end and accessibility
(`@axe-core/playwright`). Both suites exist and both will need selector updates.

**Target Platform**: Evergreen browsers; installable PWA with an offline read-only mode.

**Project Type**: Web application — this feature touches `frontend/` only.

**Performance Goals**: A 24-secret vault scannable without scrolling at 900px tall (SC-001).
Rows, chips and buttons transition background and box-shadow over 120ms; nothing animates
position. The countdown re-renders once a second and must not itself register as user activity.

**Constraints**:
- No horizontal scrolling at 360px; every interactive target ≥ 44px (SC-004).
- The application must render correctly with no network, so fonts must be local (FR-031).
- No new colours beyond the supplied token set (FR-021).
- Every user-facing string traceable to the codebase or the handoff (FR-002).

**Scale/Scope**: 14 screens/components restyled; 6 new components (`Icon`, `VaultRail`,
`LockCountdown`, `Notices`, `SecretListColumn`, `SecretDetail`) plus one new module
(`template-tint.ts`); `SecretList` split into three; 4 new test suites. ~1,800 lines of existing
presentation code touched. No data-layer change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

### I. Zero-Knowledge Encryption (NON-NEGOTIABLE) — PASS

This work performs no encryption, decryption or key derivation, and adds no code path that could.
The gate is mechanical rather than a matter of care:

> No file under `frontend/src/crypto/`, `frontend/src/vault/keyring.ts`,
> `frontend/src/vault/session.ts`, `shared/src/`, or `backend/src/` appears in this feature's
> diff. Verifiable with `git diff --name-only`.

`auto-lock.ts` is the one file in `vault/` that changes, and only to expose a timestamp it already
computes. It holds no key material.

**Risk this gate is really guarding**: the detail pane renders decrypted values, so a careless
change could put a plaintext value somewhere it is retained — a log, an analytics call, a cached
DOM snapshot. The existing rule that decrypted values live only in component state for the life
of the render still holds, and nothing in this design introduces persistence.

### II. Least-Privilege Access and Explicit Sharing — PASS (not engaged)

No authorization decision moves. The client already renders only what the server returned, and
the server's checks are untouched. Hiding a control while offline (FR-007) is a UI courtesy on
top of a server-side refusal, exactly as today.

### III. Incremental Delivery With Clarified Requirements — PASS

The spec carries no open questions: five gaps were put to the product owner and decided
(spec → "Decisions taken"). Delivery follows the handoff's eight steps, each a reviewable
checkpoint, with the two P1 user stories first.

### IV. Test-First for Security-Critical Code — **ENGAGED, with a required action**

Most of this work is presentation and needs no test-first discipline. Two parts are not:

1. **`auto-lock.ts` is session lifecycle**, which Principle IV names explicitly. It currently has
   **no unit test at all** — only an end-to-end assertion that locking clears the keys. The new
   accessor must be preceded by a failing unit test covering: the deadline while unlocked, the
   absence of one while locked, the reset on activity, and — the case that matters — that the
   ceiling and clamping are unchanged.
2. **`SensitiveField` and `CopyButton` implement FR-041 and FR-052** (masking; bounded clipboard
   retention). They become icon buttons. Their behaviour is a security standard, and neither has
   a unit test today. Tests for the mask width, the auto-re-hide, the clipboard clear and all
   three acknowledgement states must exist **before** the restyle, so the restyle is provably
   behaviour-preserving rather than assumed to be.

This is the plan's main addition beyond the handoff, and it is not optional.

### V. Schema-Driven Extensibility — PASS, and directly served

FR-023 requires a secret's colour treatment to be derived from a hash of its template name rather
than a switch on type names. That is Principle V applied to presentation: a template added
tomorrow renders correctly with no code change. The handoff calls this out by name.

The detail pane must also keep rendering a secret under the template **version** it was written
with, which the existing resolver already provides.

### Security and Data Protection Standards — one item engaged

> "Clipboard copies of secret values MUST be cleared automatically after a bounded interval."

`CopyButton` moves and changes shape. The standard is unchanged and is covered by the tests
required under Principle IV above.

### Post-Phase 1 re-check — PASS

The Phase 1 design introduces no new data flow, no new persistence, and no new network call.
The component contracts hold every preserved behaviour explicitly. No gate moved.

## Project Structure

### Documentation (this feature)

```text
specs/002-vault-workbench-redesign/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output — UI state only, no persistence
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── component-contracts.md    # Props and responsibilities of new/changed components
│   └── preserved-behaviour.md    # The regression contract: what must not change
├── checklists/
│   └── requirements.md  # Written by /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Only `frontend/` changes. Files marked **new**; everything else is edited in place.

```text
frontend/
├── public/
│   └── fonts/                                  # new — vendored woff2, precached
├── index.html                                  # color-scheme meta (FR-030d)
├── vite.config.ts                              # font precache glob
└── src/
    ├── theme.css                               # replaced by the supplied token set
    ├── App.tsx                                 # three-pane shell; settings index
    ├── components/
    │   ├── SensitiveField.tsx                  # icon button, same behaviour
    │   ├── CopyButton.tsx                      # icon button, same behaviour
    │   ├── StrengthMeter.tsx                   # segmented meter, same bands
    │   └── Icon.tsx                            # new — lucide wrapper, stroke-width 2.75
    ├── features/
    │   ├── shell/
    │   │   ├── VaultRail.tsx                   # new — vault, scopes, folders, tags, footer
    │   │   ├── LockCountdown.tsx               # new — the chip
    │   │   └── Notices.tsx                     # new — one notice at a time, by priority
    │   ├── vault-list/
    │   │   ├── SecretList.tsx                  # becomes the container: data + selection
    │   │   ├── SecretListColumn.tsx            # new — search, count, rows, New secret
    │   │   ├── VaultSwitcher.tsx               # absorbed into the rail; file removed
    │   │   └── Filters.tsx                     # absorbed into the rail; UNFILED + types kept
    │   ├── secret-detail/
    │   │   ├── SecretDetail.tsx                # new — header, fields, filing, footer
    │   │   ├── CustomFields.tsx                # restyled rows
    │   │   └── DeleteDialog.tsx                # dialog vocabulary
    │   ├── settings/                           # six panels, pane treatment
    │   ├── templates/                          # TemplateEditor, TemplateForm, ChangeWarning
    │   └── organise/, sharing/, search/, unlock/, register/
    ├── vault/
    │   └── auto-lock.ts                        # + getLockAt(); timer untouched
    └── tests/
        ├── unit/
        │   ├── auto-lock.test.ts               # new — required before the accessor
        │   ├── sensitive-field.test.tsx        # new — required before the restyle
        │   ├── copy-button.test.tsx            # new — required before the restyle
        │   └── template-tint.test.ts           # new — hash stability (FR-023)
        └── e2e/                                # selector updates; assertions unchanged
```

**Structure Decision**: The existing `frontend/src/features/<area>/` layout is kept. Two new
areas appear — `features/shell/` for the rail and its parts, and `features/secret-detail/` gains
the detail pane beside the dialog already there. `VaultSwitcher.tsx` and `Filters.tsx` are
absorbed into the rail rather than left as unused files; `Filters.tsx`'s exported `UNFILED`
constant and `FilterState`/`NamedItem` types move with them, since `SecretList` and `App` both
import them.

Component tests are a **new capability for this repo** — `@testing-library/react` is not
currently a dependency. It is added for the three unit suites Principle IV requires.

## Complexity Tracking

No constitution violations. Two things are worth recording as deliberate cost rather than
justified violation:

| Decision | Why | Simpler alternative rejected because |
|---|---|---|
| Add `lucide-react` + `@testing-library/react` | The design specifies a named icon set at a specific stroke width; Principle IV requires component-level tests that this repo cannot currently write | Hand-drawn SVGs would be more code and would drift from the spec. Testing the security-critical components only through Playwright would make each assertion a browser round-trip and would not run in the unit suite |
| Split `SecretList.tsx` (582 lines) into a container plus two panes | The container already does five jobs: fetch, decrypt, filter, search and render. The redesign separates rendering into two panes, which is the natural seam | Keeping one file would leave a ~900-line component with two independent render trees and no way to test either in isolation |

**Not carried forward**: a state-management library. All new state is local (`selectedSecretId`,
`settingsPanel`), and `FilterState` is lifted from `SecretList` to `App` by T021a so the rail can
render it. Adding a store for three values would be adding a dependency to avoid passing two props.
