# Feature Specification: Password Manager

**Feature Branch**: `001-password-manager`

**Created**: 2026-08-25

**Status**: Draft

**Input**: User description: "Build a personal password manager that supports secure storage, sharing, and custom data templates. Login with a master password and secure sessions; personal and multiple vaults that can be private or shared with other users; store website accounts, credit cards, PAN cards, secure notes and arbitrary custom data; all secret data encrypted with the user password; built-in and custom templates with custom fields; search and organisation via folders or tags; second-factor authentication via an authenticator app. Delivered as a web application with a backend API, a database, and a mobile-friendly PWA."

## Clarifications

### Session 2026-08-25

- Q: Should a user be able to arrange their own recovery in advance — and if so, by what means? → A: No recovery at all; a forgotten master password is permanent, irreversible loss.
- Q: Should users be able to download an encrypted backup of their own vault? → A: Yes, encrypted export only; no plaintext export.
- Q: Which data-protection obligations must this system meet, given that it stores credit card numbers, PAN card details, and users' email addresses? → A: Deferred to the planning phase.
- Q: Should users be able to see a history of sign-in attempts on their own account, and be notified when a security-sensitive change happens? → A: Deferred to the planning phase.

### Session 2026-09-01

- Q: When a vault owner invites someone who does not yet have an account, what should happen? → A: The invitation is held as pending against the email address, revealing nothing about the vault; access is granted only after the recipient registers and an owner's device next comes online to grant it.
- Q: When a user changes their master password, what should happen to their sessions already open on other devices? → A: Other sessions stay open but are forced to re-enter the master password on their next action, enforced by the server rather than by the client.
- Q: When a user deletes a secret, should it be recoverable for a period afterwards, or destroyed immediately once they confirm? → A: Destroyed immediately and permanently, gated behind an explicit confirmation naming the secret; no trash and no restore.
- Q: When a vault owner revokes a member's access, how should the re-encryption that revocation requires be handled? → A: Access is refused at the server immediately; re-encryption then runs in the background on the revoking owner's device with visible progress, resuming if interrupted, while the vault stays usable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Secure Vault Access and Secret Storage (Priority: P1)

A new user creates an account with a master password, unlocks their personal vault, saves a
sensitive item (for example a website login), locks the vault, and later unlocks it again to read
that item back. Nobody who obtains the stored data without the master password can read the item.

**Why this priority**: This is the irreducible core of a password manager. Without it, no other
feature has anything to operate on. It alone delivers real value: a place to keep secrets that
survives a server breach.

**Independent Test**: Can be fully tested by registering an account, saving a secret, signing out,
signing back in, and reading the secret — plus inspecting stored data to confirm no plaintext secret
value is present.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they register with an identifier and a master
   password meeting the strength policy, **Then** they are warned that a forgotten master password
   means permanent loss of their data, must acknowledge that warning, and on doing so a personal
   vault is created for them and they land in an unlocked vault.
2. **Given** an unlocked vault, **When** the user saves a secret with a title and a secret value,
   **Then** the secret appears in their vault list and the secret value is retrievable in full.
3. **Given** a saved secret, **When** the stored data is inspected outside the application, **Then**
   the secret value is not readable and the master password is not present in any stored form that
   allows decryption.
4. **Given** a returning user, **When** they enter the correct master password, **Then** the vault
   unlocks and all previously saved secrets are readable.
5. **Given** a returning user, **When** they enter an incorrect master password, **Then** access is
   refused with a message that does not reveal whether the account exists.
6. **Given** an unlocked vault, **When** the user is inactive beyond the auto-lock interval, **Then**
   the vault locks and re-entry of the master password is required before any secret is readable.

---

### User Story 2 - Typed Secrets from Built-In Templates (Priority: P2)

A user chooses the kind of thing they are saving — website account, credit card, PAN card, or secure
note — and gets a form with the right fields for that kind, with sensitive fields masked by default
and revealable on demand.

**Why this priority**: Untyped free text makes a password manager unusable at scale. Typed entries
are what make items findable, fillable, and safely displayable.

**Independent Test**: Can be fully tested by creating one secret of each built-in type, confirming
each renders its own field set, and confirming masked fields stay hidden until explicitly revealed.

**Acceptance Scenarios**:

1. **Given** an unlocked vault, **When** the user starts a new secret, **Then** they are offered the
   built-in template types and each presents its own labelled field set.
2. **Given** a credit card secret, **When** it is displayed in a list or detail view, **Then** the
   card number and security code are masked until the user explicitly reveals them.
3. **Given** a template field marked as required, **When** the user tries to save it empty, **Then**
   the save is refused with a message naming the field.
4. **Given** a saved secret of any built-in type, **When** the user edits a field and saves, **Then**
   the updated value is stored and the previous value is no longer retrievable.

---

### User Story 3 - Find and Organise Secrets (Priority: P3)

A user with many stored items finds a specific one in seconds by typing part of its name, and keeps
their vault tidy by filing items into folders and applying tags.

**Why this priority**: Retrieval speed is what determines whether the tool gets used daily. It
becomes essential as soon as the vault holds more than a handful of items.

**Independent Test**: Can be fully tested by loading a vault with many secrets, searching for one by
partial title, and filtering the list by a folder and by a tag.

**Acceptance Scenarios**:

1. **Given** a vault with many secrets, **When** the user types part of a secret's title, **Then**
   matching secrets are listed and non-matching ones are excluded.
2. **Given** a search is performed, **When** results are returned, **Then** no secret value is
   exposed to any party that cannot already decrypt it.
3. **Given** a set of secrets, **When** the user assigns a folder and one or more tags, **Then**
   filtering by that folder or tag returns exactly those secrets.
4. **Given** a folder containing secrets, **When** the user deletes the folder, **Then** the user is
   told what happens to its contents and the secrets are not silently destroyed.

---

### User Story 4 - Multiple Vaults and Sharing (Priority: P4)

A user creates a second vault (for example "Family"), invites another user to it, and both can read
its secrets. The owner later revokes that member, who immediately loses access, and the owner can
see a record of who was granted and revoked access.

**Why this priority**: Sharing is a headline requirement and the main reason to have more than one
vault. It is placed after single-user storage because it depends on vaults and secrets working.

**Independent Test**: Can be fully tested with two accounts: create a shared vault, invite the second
user, confirm they can read a secret in it, revoke them, and confirm access is refused afterwards.

**Acceptance Scenarios**:

1. **Given** an unlocked account, **When** the user creates an additional vault, **Then** it appears
   alongside the personal vault and starts private with the creator as its only member.
2. **Given** a vault the user owns, **When** they invite another existing user, **Then** that user is
   offered access and, on acceptance, can read the vault's secrets with their own master password.
3. **Given** a vault the user owns, **When** they invite an address with no account, **Then** the
   invitation is held pending, nothing about the vault is disclosed to that address, and access begins
   only after the recipient registers and an owner completes the invitation.
4. **Given** a member of a shared vault, **When** the owner revokes them, **Then** subsequent attempts
   by that user to read the vault's secrets are refused immediately, and the vault's secrets are
   re-encrypted in the background without blocking the remaining members.
5. **Given** any grant or revocation on a shared vault, **When** the owner views the vault's activity,
   **Then** the action, the actor, the affected member, and the time are recorded and cannot be
   altered or deleted.
6. **Given** a user who is not a member of a vault, **When** they request that vault or any secret in
   it, **Then** the response is indistinguishable from the vault not existing.
7. **Given** a shared vault, **When** a member acts on a secret, **Then** their permitted actions are
   limited to those granted by their role: an Owner manages membership, roles, and the vault itself;
   an Editor creates, edits, and deletes secrets but cannot manage membership; a Viewer reads and
   copies secrets but cannot create, edit, or delete them.
8. **Given** a Viewer in a shared vault, **When** they attempt to create, edit, or delete a secret,
   **Then** the action is refused by the server even if the interface offered it.

---

### User Story 5 - Two-Factor Authentication (Priority: P5)

A user links an authenticator app to their account and is then required to enter a rotating code, in
addition to their master password, when signing in from a new session.

**Why this priority**: It materially raises the cost of a stolen or guessed master password. It sits
after core storage and sharing because it protects access to those things rather than providing them.

**Independent Test**: Can be fully tested by enrolling an authenticator app, signing out, and
confirming sign-in requires a valid current code and rejects an incorrect, expired, or reused one.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they enrol a second factor, **Then** they are shown a secret
   to add to their authenticator app and must confirm one valid code before enrolment completes.
2. **Given** an enrolled user, **When** they sign in with a correct master password, **Then** they are
   required to supply a current authenticator code before the vault unlocks.
3. **Given** an enrolled user, **When** they supply an expired, incorrect, or already-used code,
   **Then** sign-in is refused and no vault content is returned.
4. **Given** a user enrolling a second factor, **When** enrolment completes, **Then** they are issued
   single-use backup codes and told these are the only way in if the authenticator is lost.

---

### User Story 6 - Custom Templates and Custom Fields (Priority: P6)

A user needs to store something the built-in types do not cover — a passport, a software licence, a
door code — so they add a field to an existing template or define an entirely new template, marking
which fields hold sensitive data.

**Why this priority**: It is what makes the tool cover a user's whole life rather than a fixed list
of item types, but every built-in type must work first.

**Independent Test**: Can be fully tested by defining a new template with a mix of sensitive and
non-sensitive fields, creating a secret from it, and confirming the sensitive fields are masked and
protected exactly as built-in ones are.

**Acceptance Scenarios**:

1. **Given** an unlocked vault, **When** the user defines a custom template with named fields and
   field types, **Then** it becomes available when creating a new secret.
2. **Given** a custom or built-in template, **When** the user adds a custom field to it, **Then**
   existing secrets created from that template remain readable and show the new field as empty.
3. **Given** a template field marked sensitive, **When** a secret using it is stored and displayed,
   **Then** that field is protected and masked identically to a built-in sensitive field.
4. **Given** a template in use by existing secrets, **When** the user removes a field from it, **Then**
   they are warned that data in that field will become inaccessible before the change is applied.

---

### User Story 7 - Install and Use on Mobile (Priority: P7)

A user installs the application to their phone's home screen and performs the same everyday tasks —
unlock, search, read a secret, copy a value — on a small touch screen.

**Why this priority**: A password manager is needed wherever the user is, but mobile delivery adds
reach to existing capability rather than adding capability.

**Independent Test**: Can be fully tested by installing the application on a mobile device and
completing unlock, search, and read of a secret entirely on that device.

**Acceptance Scenarios**:

1. **Given** a supported mobile browser, **When** the user visits the application, **Then** they are
   able to install it to the home screen and launch it as a standalone application.
2. **Given** the installed application on a phone, **When** the user performs unlock, search, and
   read, **Then** every control is usable at that screen size without horizontal scrolling.
3. **Given** a displayed secret value, **When** the user copies it to the clipboard, **Then** they are
   told it will be cleared and the clipboard no longer holds it after the stated interval.
4. **Given** the application is installed and the vault has been opened at least once online,
   **When** the device has no network connection, **Then** the user can unlock with their master
   password and read their secrets from an encrypted copy held on the device.
5. **Given** the user is working offline, **When** they attempt to create, edit, delete, or share a
   secret, **Then** the action is refused with a clear explanation that it requires connectivity.
6. **Given** an offline device holding a cached vault, **When** the cached copy is older than the
   staleness limit, **Then** it is discarded and the user is told they must reconnect to read their
   vault.

---

### Edge Cases

- **Forgotten master password**: There is no recovery. Because secrets are unreadable without the
  master password and the operator never holds it, a forgotten master password means the vault
  contents are permanently and irreversibly lost. The user must be warned of this at registration and
  must acknowledge it before the account is created. The only remaining action offered is to delete
  the account and start over.
- **Master password change**: All of the user's secrets must remain readable after a change, and the
  old master password must stop working immediately. Sessions already open on other devices are not
  ended, but must be refused by the server until they present the new master password — a device that
  already holds the unwrapped keys would otherwise keep working indefinitely, because a password
  change re-wraps the user key rather than replacing it. A device that is offline at the time cannot
  be reached, and retains access to its offline copy until it next connects.
- **Concurrent edits**: Two members of a shared vault editing the same secret at once — the second
  save must not silently discard the first.
- **Revocation mid-session**: A member revoked while they have the vault open must lose access on
  their next action, not only at their next sign-in.
- **Revocation while no owner is available**: Re-encryption after a revocation can only run on an
  owner's unlocked device. If no owner returns, the vault stays flagged as incompletely re-encrypted
  and the old key remains valid for data the revoked member already holds; server-side refusal still
  applies in the meantime.
- **Invite to a non-user**: Inviting someone who has no account — the invitation is held pending and
  must not expose the vault name or contents to an unverified recipient. Because access can only be
  granted once the recipient has an account, the grant is not immediate and depends on a later action
  by an owner; the owner must be told this rather than being left to assume access was instant.
- **Last owner removal**: Removing or demoting the only owner of a shared vault must be refused.
- **Tampered stored data**: A modified stored secret must be detected and reported as corrupt rather
  than decrypted into wrong values.
- **Repeated failed unlock attempts**: Must be rate-limited and must not reveal whether the account
  exists.
- **Account takeover leading to permanent lockout**: An intruder with a live session who changes the
  master password locks the legitimate owner out irreversibly, because no recovery path exists. The
  system must make this outcome harder to reach or easier to notice; which mechanism is used depends
  on the deferred account-security-visibility decision.
- **Very large vault**: Search and listing must stay usable as the vault grows to thousands of items.
- **Session expiry mid-edit**: An in-progress edit when the vault auto-locks must not be written in a
  partially encrypted or plaintext state.
- **Duplicate template field names**: Defining two fields with the same name in one template must be
  refused.
- **Deleting a secret**: Deletion is immediate and irreversible once confirmed, so the confirmation
  must name the secret and state plainly that it cannot be undone. In a shared vault the deletion
  takes effect for every member at once. The only recovery path is a backup taken beforehand.

## Requirements *(mandatory)*

### Functional Requirements

#### Accounts and Authentication

- **FR-001**: System MUST allow a visitor to create an account identified by an email address and
  protected by a master password.
- **FR-002**: System MUST refuse a master password shorter than 12 characters or scoring below 3 on
  a standard strength estimator, at creation and at every change, and MUST show a live strength
  indication as the user types. The check MUST run on the client, because the server never receives
  the password.
- **FR-003**: System MUST authenticate a returning user by master password and MUST return an
  identical failure response whether the account does not exist or the password is wrong.
- **FR-004**: System MUST rate-limit repeated failed authentication attempts per account and per
  origin.
- **FR-005**: Users MUST be able to change their master password, after which all their secrets
  remain readable and the previous master password no longer grants access.
- **FR-006**: System MUST establish a session on successful authentication that expires after a
  bounded lifetime and can be revoked by the user from any other session.
- **FR-007**: System MUST lock the vault automatically after a configurable period of user
  inactivity, defaulting to no more than 15 minutes, and MUST require the master password to unlock.
- **FR-008**: Users MUST be able to see their active sessions and sign out of all of them at once.
- **FR-009**: System MUST NOT provide any master password reset or recovery mechanism, and MUST NOT
  retain any means by which the operator can restore access to a vault whose master password is lost.
- **FR-010**: System MUST warn the visitor at registration that a forgotten master password means
  permanent loss of all vault contents, and MUST require an explicit acknowledgement of this before
  creating the account.
- **FR-011**: When a user reports a forgotten master password, system MUST state that recovery is
  impossible and MUST offer account deletion as the only available action.

#### Second Factor

- **FR-012**: Users MUST be able to enrol a time-based one-time-password authenticator application as
  a second factor, confirming a valid code before enrolment takes effect.
- **FR-013**: System MUST require a valid current second-factor code at sign-in for enrolled users
  and MUST reject incorrect, expired, and previously used codes.
- **FR-014**: System MUST issue single-use backup codes at enrolment and MUST accept each exactly
  once in place of an authenticator code.
- **FR-015**: Users MUST be able to remove or re-enrol their second factor after re-authenticating.

#### Encryption and Data Protection

- **FR-016**: System MUST encrypt every secret value with a key derived from the user's master
  password before that value leaves the user's device.
- **FR-017**: System MUST NOT store or transmit the master password, or any value from which the
  vault key can be derived, in a form the operator can use.
- **FR-018**: System MUST detect modified or corrupted stored secret data and MUST report it as
  corrupt rather than returning incorrect values.
- **FR-019**: System MUST hold the decrypted vault key only for the duration of an unlocked session
  and MUST discard it on lock, sign-out, and session end.
- **FR-020**: System MUST exclude secret values, master passwords, and second-factor seeds from all
  logs, error messages, and diagnostic output.

#### Vaults

- **FR-021**: System MUST create one personal vault for every new account.
- **FR-022**: Users MUST be able to create, rename, and delete additional vaults they own.
- **FR-023**: System MUST treat every vault as private until access is explicitly granted.
- **FR-024**: System MUST refuse deletion of a vault that still has other members until they are
  removed or the deletion is explicitly confirmed as affecting them.

#### Sharing

- **FR-025**: Vault owners MUST be able to invite any email address to a vault they own, whether or
  not it belongs to an existing account, and the invited user MUST accept before gaining access.
- **FR-026**: System MUST grant each member independent access to a shared vault's secrets using that
  member's own master password, without any member learning another's.
- **FR-027**: Vault owners MUST be able to revoke a member's access, after which that member's
  subsequent requests for the vault's secrets are refused.
- **FR-028**: System MUST record every grant, acceptance, revocation, and membership change on a
  shared vault in an append-only activity record showing actor, subject, action, and time.
- **FR-029**: System MUST authorize every read and write of a secret against the requester's vault
  membership on the server, independently of what the user interface offers.
- **FR-030**: System MUST return an indistinguishable "not found" response for vaults and secrets the
  requester is not a member of.
- **FR-031**: System MUST support exactly three vault roles: Owner, who manages the vault, its
  membership, and its members' roles; Editor, who may create, edit, and delete secrets but not manage
  membership; and Viewer, who may read and copy secrets but not create, edit, or delete them.
- **FR-032**: Vault owners MUST be able to assign a role when inviting a member and to change an
  existing member's role.
- **FR-033**: System MUST enforce role permissions on the server for every request, independently of
  what the interface offers, and MUST refuse a Viewer's write attempts.
- **FR-034**: System MUST record every role assignment and role change in the vault's activity
  record.
- **FR-035**: System MUST prevent removal of the last owner of a vault.

#### Secrets and Templates

- **FR-036**: System MUST provide built-in templates for website account, credit card, identity/PAN
  card, and secure note.
- **FR-037**: Users MUST be able to create, view, edit, and delete secrets in any vault they have
  access to.
- **FR-038**: System MUST define each template as a named, ordered set of fields, each with a label,
  a field type, a required flag, and a sensitive flag.
- **FR-039**: Users MUST be able to define new custom templates and to add custom fields to any
  template, without loss of access to secrets already created from it.
- **FR-040**: System MUST version template definitions so that a secret created under an earlier
  version of a template remains readable after the template changes.
- **FR-041**: System MUST encrypt every field marked sensitive and MUST mask it in all list and
  detail views until the user explicitly reveals it.
- **FR-042**: System MUST warn the user before applying a template change that would render existing
  stored data inaccessible.
- **FR-043**: System MUST refuse a template containing two fields with the same name.

#### Search and Organisation

- **FR-044**: Users MUST be able to search their accessible secrets by title and by non-sensitive
  attributes, and MUST see matching results ranked by relevance.
- **FR-045**: System MUST NOT expose secret values to any party that cannot already decrypt them in
  order to perform search.
- **FR-046**: Users MUST be able to organise secrets into folders within a vault and to apply
  multiple tags to a secret.
- **FR-047**: Users MUST be able to filter the secret list by folder and by tag.
- **FR-048**: System MUST tell the user what will happen to contained secrets before deleting a
  folder.

#### Delivery and Interface

- **FR-049**: System MUST be usable as a web application on current desktop and mobile browsers.
- **FR-050**: System MUST be installable to a mobile device home screen and MUST run as a standalone
  application once installed.
- **FR-051**: System MUST present every primary task — unlock, search, read, create, edit — usably on
  a phone-sized screen without horizontal scrolling.
- **FR-052**: When the user copies a secret value to the clipboard, system MUST clear it after a
  bounded interval and MUST tell the user that it will.
- **FR-053**: System MUST delete a secret permanently and irreversibly on confirmation, and MUST NOT
  retain a recoverable copy. The confirmation MUST name the secret being deleted and MUST state that
  deletion cannot be undone.
- **FR-054**: System MUST allow a user whose vault has been opened at least once on a device to
  unlock that vault with their master password and read its secrets while that device has no network
  connection.
- **FR-055**: System MUST hold the offline copy of a vault on the device in encrypted form only, and
  MUST NOT persist the master password or the decrypted vault key to the device.
- **FR-056**: System MUST require the master password to unlock the offline copy on every session,
  and MUST apply the same auto-lock behaviour offline as online.
- **FR-057**: System MUST refuse creating, editing, deleting, and sharing while offline, and MUST
  tell the user that these actions require connectivity.
- **FR-058**: System MUST discard a device's offline copy once it exceeds a defined staleness limit,
  on sign-out, and when the user's access to that vault is revoked, and MUST tell the user when a
  vault is unavailable offline for this reason.
- **FR-059**: Users MUST be able to disable offline access for a device, which removes any offline
  copy held on it.

#### Backup and Export

- **FR-060**: Users MUST be able to download an encrypted backup of any vault they own, containing
  every secret, folder, tag, and template definition needed to reconstruct that vault.
- **FR-061**: System MUST produce backups in encrypted form only, and MUST NOT offer any export of
  secret values in plaintext.
- **FR-062**: System MUST NOT include the master password, or any value permitting decryption without
  it, in a backup file.
- **FR-063**: Users MUST be able to restore a vault from a backup file into their account, and the
  restored vault MUST contain every secret, folder, tag, and template definition the backup held.
- **FR-064**: System MUST tell the user that a backup is readable only with the master password that
  was in force when the backup was taken, and MUST state this again at the point of a master password
  change so the user knows earlier backups now require the old password.
- **FR-065**: System MUST restrict export of a shared vault to its Owners, and MUST record every
  export of a shared vault in that vault's activity record.

#### Pending Invitations

- **FR-066**: System MUST hold an invitation to an address with no account in a pending state, and
  MUST NOT disclose the vault's name, contents, size, or member list to that address before the
  recipient has an account and has accepted.
- **FR-067**: System MUST NOT store any material capable of granting access to the vault while an
  invitation is pending, and MUST NOT transmit such material by email or in an invitation link.
- **FR-068**: System MUST complete a pending invitation only after the recipient holds an account,
  and MUST inform the inviting owner that completion requires an action by an owner and is therefore
  not immediate.
- **FR-069**: System MUST notify vault owners when a pending invitation is ready to be completed, and
  MUST grant the recipient access only once an owner has completed it.
- **FR-070**: Vault owners MUST be able to withdraw a pending invitation before it is completed, and
  System MUST record issue, withdrawal, and completion of every invitation in the vault's activity
  record.
- **FR-071**: System MUST expire a pending invitation that has not been completed within a defined
  period, and MUST require a fresh invitation thereafter.

#### Master Password Change and Other Sessions

- **FR-072**: On a master password change, system MUST mark every other session belonging to that
  user as requiring re-authentication, while leaving those sessions established.
- **FR-073**: System MUST refuse, at the server, every request from a session marked as requiring
  re-authentication, until that session presents proof of the new master password. Enforcement MUST
  NOT depend on the client choosing to honour the requirement.
- **FR-074**: A session marked as requiring re-authentication MUST discard the keys it holds and MUST
  require the user to enter the new master password before any secret is readable again, and MUST NOT
  require the second factor again.
- **FR-075**: System MUST tell the user, at the point of the password change, that their other
  devices will require the new master password and that any device left offline retains access to its
  offline copy until it next reaches the network.

#### Deletion of Secrets

- **FR-076**: System MUST remove a deleted secret's stored ciphertext, and MUST NOT retain it in any
  recoverable form once the deletion has been confirmed.
- **FR-077**: System MUST tell the user, before a deletion is confirmed, that the only way to recover
  a deleted secret is a backup taken before the deletion (FR-060 to FR-065).
- **FR-078**: When a secret is deleted from a shared vault, system MUST make clear that the deletion
  is immediate and permanent for every member, not only for the person deleting it.
- **FR-079**: System MUST record every secret deletion in the vault's activity record with actor,
  subject, and time, and MUST NOT include the deleted secret's values in that record.

#### Revocation and Re-encryption

- **FR-080**: System MUST refuse a revoked member's requests for the vault immediately on revocation,
  independently of whether the vault's secrets have been re-encrypted yet.
- **FR-081**: System MUST replace a vault's encryption key on revocation and MUST re-encrypt
  everything in that vault protected by the old key — every secret value, every secret title, every
  folder name, every tag name, and the vault's own name — under the replacement key. System MUST NOT
  discard the old key while any of these still requires it.
- **FR-082**: System MUST perform re-encryption in the background on the revoking owner's device,
  MUST show its progress, and MUST keep the vault readable and writable by remaining members while it
  runs.
- **FR-083**: System MUST resume an interrupted re-encryption and MUST NOT leave a vault in a state
  where some secrets are readable by remaining members and others are not.
- **FR-084**: System MUST show a persistent indication on any vault whose re-encryption is incomplete,
  and MUST tell owners that the removed member's copy of the old key remains valid for data they
  already hold until re-encryption completes.
- **FR-085**: System MUST make clear that re-encryption limits what a revoked member can read in
  future, and cannot affect any secret they already read or copied while they had access.

### Key Entities *(include if feature involves data)*

- **User**: A person with an account. Identified by an email address. Holds authentication material
  derived from their master password, second-factor enrolment state, and backup codes. Never stores
  the master password itself.
- **Vault**: A named container for secrets, owned by a user. Either private to its owner or shared
  with other users. Every account has exactly one personal vault plus any it creates.
- **Vault Membership**: The link between a user and a vault they can access. Carries the member's
  role (Owner, Editor, or Viewer), the state of their invitation, and the member-specific material
  that lets only that user unlock the vault.
- **Secret**: One stored item, belonging to exactly one vault and created from exactly one template
  version. Has a title, a folder, tags, and a set of field values of which the sensitive ones are
  stored encrypted.
- **Template**: A named, versioned definition of what fields a kind of secret has. Either built-in or
  user-created. Owned globally (built-in) or by a user (custom).
- **Template Field**: One field within a template — label, type, required flag, sensitive flag, and
  display order.
- **Folder**: A named grouping of secrets within a single vault. A secret belongs to at most one.
- **Tag**: A user-defined label applied to secrets. A secret may carry many.
- **Session**: An authenticated, time-bounded period of access for one user on one device, revocable
  by the user and expiring on inactivity.
- **Activity Record**: An append-only entry describing an access-control event on a shared vault —
  who acted, on whom, what action, and when. Covers invitations, acceptances, revocations, and role
  changes.
- **Encrypted Backup**: A user-downloaded file holding one vault's secrets, folders, tags, and
  template definitions in encrypted form. Readable only with the master password in force when it was
  taken. Never contains plaintext secret values.
- **Offline Vault Copy**: An encrypted copy of a vault's secrets held on one device to permit reading
  without connectivity. Carries the time it was last refreshed, is unreadable without the master
  password, and is discarded on staleness, sign-out, or revocation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can register, unlock their vault, and save their first secret in under 3
  minutes without consulting documentation.
- **SC-002**: A returning user can go from opening the application to reading a specific secret in
  under 15 seconds, including unlock and search.
- **SC-003**: Searching a vault of 5,000 secrets returns results in under 1 second for 95% of
  searches.
- **SC-004**: Given the complete stored data set and no master password, no secret value can be read
  — verified by an independent inspection of the stored data.
- **SC-005**: A revoked shared-vault member loses the ability to read that vault's secrets within 60
  seconds of revocation, verified with an active session open at the time of revocation.
- **SC-006**: 100% of access-control events on shared vaults appear in the vault's activity record.
- **SC-007**: A user can define a custom template and save a secret using it in under 2 minutes.
- **SC-008**: 90% of first-time users successfully complete registration, second-factor enrolment,
  and first secret creation without assistance.
- **SC-009**: Every primary task is completable on a 360-pixel-wide screen with no horizontal
  scrolling and no control smaller than the platform's minimum touch target.
- **SC-010**: The application supports 1,000 concurrent active users with no measurable degradation
  in the times stated in SC-002 and SC-003.
- **SC-011**: A user who has opened a vault online can unlock and read that vault on the same device
  with the network fully disabled, in the time stated in SC-002.
- **SC-012**: 100% of write attempts by a Viewer are refused at the server, verified by exercising
  each write operation directly rather than through the interface.
- **SC-013**: No secret value is readable from a device holding an offline copy without the master
  password — verified by inspecting the device's stored data.
- **SC-014**: A vault of 5,000 secrets can be exported and restored into a clean account with 100%
  fidelity across secrets, folders, tags, and template definitions.
- **SC-015**: No secret value is readable from an exported backup file without the master password —
  verified by inspecting the file's contents.

## Assumptions

- **Registration is in scope.** The brief mentions only login, but sharing requires identifiable
  accounts, so self-service registration by email address is assumed. Email address is assumed to be
  the user identifier; email verification is assumed to be required before a user can gain access to a
  shared vault, though an invitation may be addressed to an unverified or not-yet-registered address
  and held pending.
- **There is no master password recovery.** A forgotten master password means permanent loss of the
  vault. This is a direct consequence of zero-knowledge encryption, and it is assumed that the
  onboarding flow makes the stakes unmistakable rather than burying them in terms of service. Support
  cannot restore access, and this shapes what support is able to promise.
- **Escrow-based recovery was considered and rejected for this feature.** Both a user-held recovery
  key (an offline code that unwraps the vault key) and emergency access (a trusted contact who gains
  access after a waiting period) would preserve zero-knowledge, because each escrows the key to a
  party the user chooses rather than to the operator. Both are deliberately excluded here. Neither
  may be introduced during planning without amending this specification, because adding either after
  launch requires re-keying every existing account.
- **Zero-knowledge is binding.** Per the project constitution, encryption happens on the user's
  device and the operator can never read secrets. This is assumed to be a fixed constraint rather
  than a trade-off available to later phases, and it is what makes master password recovery a real
  question rather than a routine feature.
- **Search is client-side over decrypted data**, or over non-sensitive attributes only, since the
  server cannot read secret values. Users are assumed to accept that full-text search does not reach
  the contents of sensitive fields.
- **Second factor protects the account, not the vault key.** A second factor gates server access; it
  does not participate in deriving the encryption key, so it cannot compensate for a lost master
  password.
- **Sharing is always with a named, verified account of this system.** An invitation may be addressed
  to someone who has no account yet, in which case it is held pending until they register and an owner
  completes it (FR-066 to FR-071). Sharing by public link or with an anonymous recipient is not
  assumed.
- **Master password strength is enforced client-side only**, because the server never receives the
  password and so cannot verify its strength. A modified client could bypass the check; this is
  accepted, since a user determined to weaken their own master password is not the threat the control
  addresses. The control exists to stop *accidental* weak choices on an account that can never be
  recovered.
- **Auto-lock default is 15 minutes**, user-configurable downward, per the constitution's ceiling.
- **Clipboard clearing interval is 30 seconds** unless the user configures otherwise.
- **Deleted secrets are removed immediately and permanently** on confirmation. There is no trash and
  no restore; a backup taken before the deletion is the only recovery path.
- **Offline is read-only.** Reading works without connectivity from an encrypted on-device copy; all
  writes and all sharing require connectivity. This avoids conflict resolution entirely, at the cost
  of users being unable to add an item while offline.
- **Offline copies expire after 30 days** without a successful online refresh, and offline access is
  assumed to be on by default with a per-device off switch.
- **Modern browsers only.** Current versions of the major browsers on desktop and mobile; legacy
  browser support is not assumed.
- **Single operator deployment.** Self-hosting by third parties, multi-tenant isolation beyond
  per-user access control, and organisation/team administration are not assumed.

### Deferred Decisions

These are known open decisions, deliberately not settled in this specification. Planning MUST resolve
them before the affected work is scheduled.

- **Regulatory obligations are unresolved.** The system stores credit card numbers, PAN card details,
  and email addresses. Whether it must satisfy GDPR and India's DPDP Act (data export, full account
  deletion, breach notification, stated retention periods), and how PCI DSS scope is argued for
  encrypted card data the operator cannot decrypt, is deferred to planning. This is deferred, not
  dismissed: account metadata such as email addresses, vault names, and activity records is personal
  data regardless of vault encryption, and the associated rights are substantially cheaper to design
  in than to retrofit.

- **Account security visibility is unresolved.** Whether users get a sign-in history (successful and
  failed attempts with time, device, and approximate location) and whether the system notifies them
  of new-device sign-ins, master password changes, second-factor removal, and vault export, is
  deferred to planning. The spec currently provides only the active-sessions list (FR-008). This
  interacts with the no-recovery decision — see the edge case below — so planning should resolve it
  before the authentication work is scheduled.

### Out of Scope for This Feature

The brief lists these as optional enhancements; they are deliberately excluded here so that the core
can ship, and each can be specified separately later:

- Password generator and standalone password strength auditing of stored entries
- Import from other password managers, and plaintext export for migrating to them (encrypted
  backup export is in scope — see FR-060 to FR-065)
- Google Drive or other external backup and restore integration
- Dark mode and other theming
- Browser extension and autofill
- Breach monitoring and password health reporting
- Organisation, team, or administrator roles beyond per-vault ownership

Auto-lock and clipboard clearing appear in the optional list in the brief but are treated as in scope
here, because the project constitution mandates both.
