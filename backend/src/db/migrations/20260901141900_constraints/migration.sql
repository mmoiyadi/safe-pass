-- Constraints and partial unique indexes that Prisma's schema language cannot express.
-- See specs/001-password-manager/data-model.md.

-- Constitution states 15 minutes as a CEILING, so it is enforced by the database and not
-- only by application code.
ALTER TABLE "user"
  ADD CONSTRAINT "user_auto_lock_ceiling" CHECK ("autoLockMinutes" BETWEEN 1 AND 15);

-- FR-021: exactly one personal vault per user.
CREATE UNIQUE INDEX "vault_one_personal_per_owner"
  ON "vault" ("ownerId") WHERE "kind" = 'personal';

-- Only one rotation may be open at a time; two live generations is the maximum
-- (contracts/crypto-envelope.md, "Vault key generations", rule 5).
CREATE UNIQUE INDEX "vault_rotation_one_running"
  ON "vault_rotation" ("vaultId") WHERE "state" = 'running';

-- At most one live invitation per (vault, email). Terminal states may accumulate.
CREATE UNIQUE INDEX "vault_invitation_one_live"
  ON "vault_invitation" ("vaultId", "inviteeEmail")
  WHERE "state" IN ('pending', 'ready');

-- A rotation's generations must be adjacent and ascending.
ALTER TABLE "vault_rotation"
  ADD CONSTRAINT "vault_rotation_version_step" CHECK ("toVersion" = "fromVersion" + 1);

-- A key wrap can only exist at a generation the vault has actually reached.
ALTER TABLE "vault_key_wrap"
  ADD CONSTRAINT "vault_key_wrap_version_positive" CHECK ("keyVersion" >= 1);
