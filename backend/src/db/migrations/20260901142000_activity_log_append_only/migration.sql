-- Principle II requires the activity log be unalterable. A convention in application code is
-- not that, so the guarantee is enforced by the database.
--
-- IMPORTANT, learned by testing this against a real server rather than by inspection:
-- a REVOKE against the table's OWNER is a no-op. PostgreSQL always grants the owner full
-- privileges on its own tables, so if the application connects as the role that ran the
-- migrations, REVOKE UPDATE/DELETE changes nothing and provides only false confidence.
--
-- Two mechanisms are therefore used together:
--   1. a dedicated NON-OWNER application role, which the REVOKE actually binds
--   2. a trigger, which holds even if the application is (mis)configured to connect as owner
--
-- Quickstart V5 asserts this by attempting an UPDATE and requiring it to fail.

-- 1. The application role. Owns nothing, so privileges granted to it are real.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pm_app') THEN
    CREATE ROLE pm_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO pm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pm_app;

-- The activity log is the exception: insert and read only.
REVOKE UPDATE, DELETE ON TABLE "activity_log_entry" FROM pm_app;

-- 2. Defence in depth. Binds every role, owner included.
CREATE OR REPLACE FUNCTION activity_log_is_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'activity_log_entry is append-only (Constitution Principle II)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activity_log_no_update ON "activity_log_entry";
CREATE TRIGGER activity_log_no_update
  BEFORE UPDATE OR DELETE ON "activity_log_entry"
  FOR EACH ROW EXECUTE FUNCTION activity_log_is_append_only();
