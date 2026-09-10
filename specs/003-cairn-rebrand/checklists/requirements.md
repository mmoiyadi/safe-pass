# Specification Quality Checklist: Cairn Rebrand

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-10
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs)
- [X] Focused on user value and business needs
- [X] Written for non-technical stakeholders
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous
- [X] Success criteria are measurable
- [X] Success criteria are technology-agnostic (no implementation details)
- [X] All acceptance scenarios are defined
- [X] Edge cases are identified
- [X] Scope is clearly bounded
- [X] Dependencies and assumptions identified

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria
- [X] User scenarios cover primary flows
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification

## Notes

### On "no implementation details"

The spec names user-visible surfaces — the browser tab, the installed application, the rail's
brand row, outbound mail — because a rebrand is defined by where a name is read. That is subject
matter, not implementation. No requirement names a file, a framework, a component API or a colour
token; the handoff carries those and the plan will.

The one place this is closest to the line is FR-006's size thresholds (20 and 32 pixels). They are
kept because they are the *observable* rule the mark follows — a reader can check them by looking
at the mark — and without them "the mark stays legible when small" is untestable.

### On the two numeric values that appear

16 and 512 pixels appear in SC-002 as the range the mark must survive. They are the sizes browsers
and platforms actually request, not choices this feature makes.

### On the trademark precondition

FR-001 is a requirement rather than a note because it gates the work rather than following it. The
handoff's author found an active cybersecurity company operating under this name in an adjacent
segment and could not reach a register to check the relevant classes. A specification that buried
that in an assumptions list would be understating it.

### Discrepancies

Five disagreements between the handoff and the codebase are recorded in the spec rather than
resolved by guessing. Two matter for scope: the handoff's font work is already complete, and the
handoff omits the second-factor issuer, which is user-visible and carries a constraint of its own
(an existing second factor must keep verifying).

One is a direct conflict with a shipped requirement: FR-022a of the vault workbench redesign
*requires* the rail to read "Password Manager". This spec supersedes it, and says so in the
Overview rather than leaving a reader to discover two requirements that contradict.

### Validation

All items pass on the first iteration. No clarification markers were needed: the handoff is
specific about what changes, and every gap it left was resolvable by reading the codebase.
