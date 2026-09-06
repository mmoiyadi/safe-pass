-- CreateEnum
CREATE TYPE "VaultKind" AS ENUM ('personal', 'standard');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('invited', 'active', 'revoked');

-- CreateEnum
CREATE TYPE "InvitationState" AS ENUM ('pending', 'ready', 'completed', 'withdrawn', 'expired');

-- CreateEnum
CREATE TYPE "RotationState" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "KdfAlgorithm" AS ENUM ('argon2id', 'pbkdf2');

-- CreateEnum
CREATE TYPE "SignInOutcome" AS ENUM ('success', 'bad_password', 'bad_totp', 'rate_limited');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('builtin', 'custom');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "authHashDigest" BYTEA NOT NULL,
    "kdfAlgorithm" "KdfAlgorithm" NOT NULL DEFAULT 'argon2id',
    "kdfMemoryKib" INTEGER NOT NULL DEFAULT 65536,
    "kdfIterations" INTEGER NOT NULL DEFAULT 3,
    "kdfParallelism" INTEGER NOT NULL DEFAULT 1,
    "recoveryAcknowledgedAt" TIMESTAMP(3) NOT NULL,
    "autoLockMinutes" INTEGER NOT NULL DEFAULT 15,
    "offlineAccessEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deletionRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_keyring" (
    "userId" TEXT NOT NULL,
    "wrappedUserKey" BYTEA NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "wrappedPrivateKey" BYTEA NOT NULL,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_keyring_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "vault" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" BYTEA NOT NULL,
    "kind" "VaultKind" NOT NULL DEFAULT 'standard',
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "nameKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_membership" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'invited',
    "invitedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_key_wrap" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "wrappedVaultKey" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_key_wrap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_invitation" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "invitedById" TEXT NOT NULL,
    "state" "InvitationState" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "membershipId" TEXT,

    CONSTRAINT "vault_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_rotation" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "fromVersion" INTEGER NOT NULL,
    "toVersion" INTEGER NOT NULL,
    "state" "RotationState" NOT NULL DEFAULT 'running',
    "cursor" TEXT,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "doneCount" INTEGER NOT NULL DEFAULT 0,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "vault_rotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secret" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "title" BYTEA NOT NULL,
    "folderId" TEXT,
    "fieldValues" JSONB NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folder" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "name" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "name" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secret_tag" (
    "secretId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "secret_tag_pkey" PRIMARY KEY ("secretId","tagId")
);

-- CreateTable
CREATE TABLE "template" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "kind" "TemplateKind" NOT NULL DEFAULT 'custom',
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_version" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenDigest" BYTEA NOT NULL,
    "deviceLabel" TEXT,
    "ipHash" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "reauthRequiredAt" TIMESTAMP(3),
    "pendingTotp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sign_in_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" "SignInOutcome" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coarseLocation" TEXT,
    "deviceLabel" TEXT,

    CONSTRAINT "sign_in_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_enrolment" (
    "userId" TEXT NOT NULL,
    "wrappedSecret" BYTEA NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "lastUsedStep" BIGINT,

    CONSTRAINT "totp_enrolment_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "backup_code" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeDigest" BYTEA NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "backup_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log_entry" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "actorId" TEXT,
    "subjectId" TEXT,
    "action" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "activity_log_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "vault_ownerId_idx" ON "vault"("ownerId");

-- CreateIndex
CREATE INDEX "vault_membership_userId_status_idx" ON "vault_membership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vault_membership_vaultId_userId_key" ON "vault_membership"("vaultId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "vault_key_wrap_membershipId_keyVersion_key" ON "vault_key_wrap"("membershipId", "keyVersion");

-- CreateIndex
CREATE INDEX "vault_invitation_inviteeEmail_state_idx" ON "vault_invitation"("inviteeEmail", "state");

-- CreateIndex
CREATE INDEX "vault_rotation_vaultId_state_idx" ON "vault_rotation"("vaultId", "state");

-- CreateIndex
CREATE INDEX "secret_vaultId_idx" ON "secret"("vaultId");

-- CreateIndex
CREATE INDEX "secret_vaultId_keyVersion_id_idx" ON "secret"("vaultId", "keyVersion", "id");

-- CreateIndex
CREATE INDEX "folder_vaultId_keyVersion_idx" ON "folder"("vaultId", "keyVersion");

-- CreateIndex
CREATE INDEX "tag_vaultId_keyVersion_idx" ON "tag"("vaultId", "keyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "template_version_templateId_version_key" ON "template_version"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "session_tokenDigest_key" ON "session"("tokenDigest");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "sign_in_event_userId_at_idx" ON "sign_in_event"("userId", "at");

-- CreateIndex
CREATE INDEX "backup_code_userId_idx" ON "backup_code"("userId");

-- CreateIndex
CREATE INDEX "activity_log_entry_vaultId_at_idx" ON "activity_log_entry"("vaultId", "at");

-- AddForeignKey
ALTER TABLE "user_keyring" ADD CONSTRAINT "user_keyring_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault" ADD CONSTRAINT "vault_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_membership" ADD CONSTRAINT "vault_membership_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_membership" ADD CONSTRAINT "vault_membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_key_wrap" ADD CONSTRAINT "vault_key_wrap_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "vault_membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_invitation" ADD CONSTRAINT "vault_invitation_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_invitation" ADD CONSTRAINT "vault_invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_rotation" ADD CONSTRAINT "vault_rotation_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_rotation" ADD CONSTRAINT "vault_rotation_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret" ADD CONSTRAINT "secret_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret" ADD CONSTRAINT "secret_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "template_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret" ADD CONSTRAINT "secret_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folder" ADD CONSTRAINT "folder_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret_tag" ADD CONSTRAINT "secret_tag_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secret"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret_tag" ADD CONSTRAINT "secret_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template" ADD CONSTRAINT "template_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_version" ADD CONSTRAINT "template_version_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_in_event" ADD CONSTRAINT "sign_in_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_enrolment" ADD CONSTRAINT "totp_enrolment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_code" ADD CONSTRAINT "backup_code_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log_entry" ADD CONSTRAINT "activity_log_entry_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log_entry" ADD CONSTRAINT "activity_log_entry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
