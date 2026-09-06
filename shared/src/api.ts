/**
 * API request/response types, mirroring contracts/openapi.yaml.
 *
 * Every field carrying secret data is typed as Envelope<T>, so a plaintext string cannot be
 * placed into a request body without a compile error. That is the point of this file.
 */
import type {
  Envelope,
  FolderName,
  SecretFieldValue,
  SecretTitle,
  TagName,
  TotpSeed,
  VaultName,
  WrappedKey,
} from './envelope.js';

export type Uuid = string;
export type IsoDateTime = string;
export type Role = 'owner' | 'editor' | 'viewer';
export type MembershipStatus = 'invited' | 'active' | 'revoked';
export type InvitationState = 'pending' | 'ready' | 'completed' | 'withdrawn' | 'expired';
export type RotationState = 'running' | 'completed' | 'failed';

/* ----------------------------- auth ----------------------------- */

export interface KdfParams {
  algorithm: 'argon2id' | 'pbkdf2';
  memoryKib: number;
  iterations: number;
  parallelism: number;
}

/** Returned for ANY email, real or not, so this endpoint cannot enumerate accounts (FR-003). */
export type KdfParamsResponse = KdfParams;

export interface RegisterRequest {
  email: string;
  /** Argon2id(MasterKey, salt=masterPassword). Proves knowledge; cannot decrypt. */
  authHash: string;
  kdfParams: KdfParams;
  wrappedUserKey: Envelope<WrappedKey>;
  /** RSA-4096 SPKI, base64url. Public by design. */
  publicKey: string;
  wrappedPrivateKey: Envelope<WrappedKey>;
  wrappedVaultKey: Envelope<WrappedKey>;
  personalVaultName: Envelope<VaultName>;
  /** FR-010: registration is refused unless this is true. */
  recoveryAcknowledged: true;
}

export interface LoginRequest {
  email: string;
  authHash: string;
}

export interface Keyring {
  wrappedUserKey: Envelope<WrappedKey>;
  wrappedPrivateKey: Envelope<WrappedKey>;
  publicKey: string;
}

export interface ChangeMasterPasswordRequest {
  currentAuthHash: string;
  newAuthHash: string;
  newWrappedUserKey: Envelope<WrappedKey>;
  newKdfParams: KdfParams;
}

/** The only route a session stamped reauthRequired may call (FR-073). */
export interface ReauthRequest {
  authHash: string;
}

export interface SessionSummary {
  id: Uuid;
  deviceLabel: string;
  createdAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  expiresAt: IsoDateTime;
  current: boolean;
  /** True after a master password change elsewhere; server refuses all data routes (FR-073). */
  reauthRequired: boolean;
}

/* ----------------------------- vaults ---------------------------- */

export interface VaultSummary {
  id: Uuid;
  name: Envelope<VaultName>;
  kind: 'personal' | 'standard';
  keyVersion: number;
  nameKeyVersion: number;
  role: Role;
  /** True while a rotation is open; surfaces the persistent banner (FR-084). */
  rotationPending: boolean;
}

export interface Membership {
  userId: Uuid;
  email: string;
  role: Role;
  status: MembershipStatus;
  /** Every generation this member holds a wrap for. Two while a rotation is open. */
  keyVersions: number[];
}

/** Carries NO key material by design (FR-067). */
export interface Invitation {
  id: Uuid;
  vaultId: Uuid;
  inviteeEmail: string;
  role: Role;
  state: InvitationState;
  invitedByEmail: string;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

export interface InviteRequest {
  email: string;
  role: Role;
  /** Omitted when the address has no account — the server then records a pending invitation. */
  wrappedVaultKey?: Envelope<WrappedKey>;
}

export interface CompleteInvitationRequest {
  wrappedVaultKey: Envelope<WrappedKey>;
  keyVersion: number;
}

/* ---------------------------- rotation --------------------------- */

export interface Rotation {
  id: Uuid;
  vaultId: Uuid;
  fromVersion: number;
  toVersion: number;
  state: RotationState;
  /** Resume point for the secret walk only; see contracts/openapi.yaml. */
  cursor: Uuid | null;
  totalCount: number;
  doneCount: number;
  startedAt: IsoDateTime;
}

export interface OpenRotationRequest {
  toVersion: number;
  memberKeys: Array<{ userId: Uuid; wrappedVaultKey: Envelope<WrappedKey> }>;
}

/**
 * At least one of secrets, folders, tags, or vaultName must be present.
 * All four are encrypted under the VaultKey and all four must reach toVersion before close
 * (FR-081) — closing on secrets alone destroys the only key that opens the rest.
 */
export interface RotationBatchRequest {
  toVersion: number;
  secrets?: Array<{
    id: Uuid;
    title: Envelope<SecretTitle>;
    fieldValues: Record<string, Envelope<SecretFieldValue>>;
  }>;
  folders?: Array<{ id: Uuid; name: Envelope<FolderName> }>;
  tags?: Array<{ id: Uuid; name: Envelope<TagName> }>;
  vaultName?: Envelope<VaultName>;
}

/* ----------------------------- secrets --------------------------- */

export interface SecretRecord {
  id: Uuid;
  vaultId: Uuid;
  templateVersionId: Uuid;
  title: Envelope<SecretTitle>;
  folderId: Uuid | null;
  tagIds: Uuid[];
  fieldValues: Record<string, Envelope<SecretFieldValue>>;
  keyVersion: number;
  revision: number;
  updatedAt: IsoDateTime;
}

export interface SecretWriteRequest {
  templateVersionId: Uuid;
  title: Envelope<SecretTitle>;
  folderId?: Uuid | null;
  tagIds?: Uuid[];
  fieldValues: Record<string, Envelope<SecretFieldValue>>;
  keyVersion: number;
  /** Required on update. A mismatch returns 409 REVISION_CONFLICT with the current row. */
  revision?: number;
}

/* ---------------------------- templates -------------------------- */

export type FieldType =
  | 'text'
  | 'password'
  | 'email'
  | 'url'
  | 'number'
  | 'date'
  | 'totp'
  | 'multiline';

export interface TemplateField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Drives encryption. Which fields are secret is a property of the data, not the UI (FR-041). */
  sensitive: boolean;
  order: number;
}

export interface TemplateVersionRecord {
  id: Uuid;
  templateId: Uuid;
  version: number;
  name: string;
  fields: TemplateField[];
  createdAt: IsoDateTime;
}

/* ------------------------ security visibility -------------------- */

export interface SignInEventRecord {
  id: Uuid;
  outcome: 'success' | 'bad_password' | 'bad_totp' | 'rate_limited';
  at: IsoDateTime;
  coarseLocation: string | null;
  deviceLabel: string | null;
}

export interface TotpEnrolRequest {
  wrappedSecret: Envelope<TotpSeed>;
  /** Client-verified proof, since the server cannot read the seed (contracts/README.md). */
  proof: string;
}
