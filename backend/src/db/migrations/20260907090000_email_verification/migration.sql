-- Email address verification (T144).
--
-- Verification is what makes "share with alice@example.com" mean anything: without it, whoever
-- registers an address first becomes a valid target for someone else's vault key.
--
-- The token is stored as a digest, never in the clear. A read of this table must not let its
-- holder verify an account and so become shareable-with.
CREATE TABLE "email_verification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenDigest" BYTEA NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_verification_userId_idx" ON "email_verification"("userId");

ALTER TABLE "email_verification"
  ADD CONSTRAINT "email_verification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The application role needs the same access it has to the other auth tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pm_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "email_verification" TO pm_app;
  END IF;
END
$$;
