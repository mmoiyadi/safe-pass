<!--
Sync Impact Report
==================
Version change: TEMPLATE (unversioned placeholders) → 1.0.0
Bump rationale: Initial ratification. The prior file was the unfilled core scaffold with no
concrete governance, so this is the first real constitution rather than an amendment.

Modified principles:
- [PRINCIPLE_1_NAME] → I. Zero-Knowledge Encryption (NON-NEGOTIABLE)
- [PRINCIPLE_2_NAME] → II. Least-Privilege Access and Explicit Sharing
- [PRINCIPLE_3_NAME] → III. Incremental Delivery With Clarified Requirements
- [PRINCIPLE_4_NAME] → IV. Test-First for Security-Critical Code
- [PRINCIPLE_5_NAME] → V. Schema-Driven Extensibility

Added sections:
- Security and Data Protection Standards (from [SECTION_2_NAME])
- Development Workflow and Quality Gates (from [SECTION_3_NAME])
- Governance (populated)

Removed sections: none

Deferred TODOs: none
-->

# Password Manager Constitution

## Core Principles

### I. Zero-Knowledge Encryption (NON-NEGOTIABLE)

Secret material MUST be encrypted with a key derived from the user's master password, and the
server MUST never receive the master password, a key derived from it, or plaintext secret values.
Encryption and decryption MUST happen client-side. The master password MUST be processed through a
memory-hard key derivation function (Argon2id preferred; scrypt or PBKDF2 with a documented work
factor acceptable) with a per-user random salt. Authenticated encryption (AEAD, e.g. AES-256-GCM or
XChaCha20-Poly1305) MUST be used for every secret payload, with a unique nonce per encryption.
Cryptographic primitives MUST come from a vetted platform or library implementation; hand-rolled
cryptography is forbidden.

Rationale: A password manager's entire value is that a breach of the server yields nothing usable.
Any design that lets the server see plaintext or derive the vault key voids that guarantee.

### II. Least-Privilege Access and Explicit Sharing

Every read or write of a secret MUST be authorized server-side against the requesting user's
identity; client-side checks are UX only and MUST NOT be the enforcement point. Access to a vault
MUST be explicitly granted, never inherited by default. Shared vaults MUST use per-recipient key
wrapping so that revoking a member removes their ability to decrypt future data without re-keying
unrelated vaults. Every grant, revocation, and share action on a shared vault MUST be recorded in an
append-only audit log. Enumeration of vaults, secrets, or users belonging to another account MUST
return the same response as a non-existent resource.

Rationale: Sharing is the feature most likely to leak data, because it crosses trust boundaries that
authentication alone does not cover.

### III. Incremental Delivery With Clarified Requirements

Features MUST be delivered as small, independently shippable slices; a slice MUST be functional
end-to-end (data model through UI) before the next slice begins. Before implementing a feature that
touches the data model, security posture, sharing permissions, or user-visible behavior, open
questions MUST be resolved and recorded in the feature spec rather than resolved by assumption.
Ambiguity discovered mid-implementation MUST be surfaced as a clarification, not silently decided.
Speculative capability with no current consumer MUST NOT be built.

Rationale: The scope here spans auth, crypto, sharing, templates, and PWA delivery. Unclarified
assumptions compound into rework, and in the security-critical paths they compound into defects that
are expensive to discover.

### IV. Test-First for Security-Critical Code

Authentication, key derivation, encryption and decryption, authorization checks, sharing and
revocation, session lifecycle, and 2FA verification MUST have failing tests written and reviewed
before their implementation. Each such test suite MUST cover the negative cases explicitly: wrong
master password, expired or replayed session, revoked share, tampered ciphertext, reused nonce,
missing or invalid TOTP code. Cryptographic round-trip behavior MUST be verified against known
answer vectors where the algorithm defines them. Non-security code SHOULD follow the same
test-first cycle but MAY be tested after implementation when the behavior is purely presentational.

Rationale: These paths fail silently and are the paths an attacker exercises. Writing the test first
forces the failure mode to be specified before the happy path makes it invisible.

### V. Schema-Driven Extensibility

Secret types, their fields, and validation rules MUST be defined as data (template definitions
persisted in the database), not as hardcoded application types. Adding a built-in template, a custom
template, or a custom field to an existing template MUST require no schema migration and no code
change. Template definitions MUST be versioned so that existing secrets remain readable after their
template evolves. Field-level encryption boundaries MUST be declared in the template, so that which
fields are secret is a property of the data, not of the rendering code.

Rationale: The brief requires arbitrary user-defined data. Encoding types in code turns every new
secret type into a deployment, and turns "which fields are sensitive" into a question the UI answers
inconsistently.

## Security and Data Protection Standards

The application MUST be a web application backed by an HTTP API and a persistent database, delivered
as an installable PWA with a mobile-first responsive UI.

- All traffic MUST be served over TLS. Secrets MUST NOT be transmitted or logged in plaintext.
- Sessions MUST expire after a bounded lifetime and MUST be revocable server-side. The decrypted
  vault key MUST live only in memory for the duration of an unlocked session and MUST be cleared on
  lock, logout, or tab close. It MUST NOT be written to `localStorage`, cookies, or IndexedDB.
- The vault MUST auto-lock after a configurable inactivity period, defaulting to no more than 15
  minutes.
- TOTP-based second-factor authentication (RFC 6238) MUST be supported. TOTP seeds MUST be stored
  encrypted at rest, and verification MUST reject replayed codes within the same time step.
- Logs, error messages, telemetry, and crash reports MUST NOT contain secret values, master
  passwords, derived keys, decrypted payloads, or TOTP seeds.
- Authentication endpoints MUST be rate-limited and MUST return responses that do not distinguish
  "unknown user" from "wrong password".
- Dependencies handling cryptography, authentication, or serialization MUST be pinned and MUST be
  reviewed for known advisories before a release.
- Clipboard copies of secret values MUST be cleared automatically after a bounded interval.

## Development Workflow and Quality Gates

- Work MUST follow the Spec Kit flow: specification, plan, tasks, then implementation. Code that has
  no corresponding task in an approved spec MUST NOT be merged.
- Every change MUST state which principles it engages. A change that conflicts with a principle MUST
  either be redesigned or accompanied by a documented, approved exception before merge.
- Automated tests MUST pass before merge. A change to any security-critical path defined in
  Principle IV MUST NOT merge on a red or skipped suite.
- Changes touching cryptography, authentication, authorization, or sharing MUST receive a review
  explicitly covering the threat model, not only code style.
- Data model changes MUST ship with a forward migration, and MUST document how existing encrypted
  records remain decryptable.
- Complexity MUST be justified in the plan. Where a simpler design satisfies the same requirement and
  the same threat model, the simpler design MUST be chosen.

## Governance

This constitution supersedes other practices, conventions, and preferences in this project. Where a
tool default, a template, or an agent guidance file conflicts with it, this document wins.

Amendments MUST be proposed as an explicit change to this file, MUST state the rationale, and MUST
identify any in-flight work that the change invalidates along with its migration path. An amendment
takes effect only once merged.

Versioning follows semantic versioning:

- MAJOR: a principle is removed or redefined in a way that invalidates existing compliant work, or
  governance rules change incompatibly.
- MINOR: a principle or section is added, or existing guidance is materially expanded.
- PATCH: clarifications, wording, and non-semantic refinements.

Compliance is reviewed at every merge: reviewers MUST verify that the change satisfies the
principles it engages, and MUST block merge on an unjustified violation. Approved exceptions MUST be
recorded in the feature's plan with a scope and an expiry, and MUST NOT be treated as precedent.

**Version**: 1.0.0 | **Ratified**: 2026-08-25 | **Last Amended**: 2026-08-25
