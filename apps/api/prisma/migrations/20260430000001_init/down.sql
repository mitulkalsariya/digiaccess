-- Reverse of 20260430000001_init.
-- DoD: "Migration is reversible / safe to roll back".
-- Apply manually via `psql -f down.sql` if the corresponding up migration must be undone.
DROP TABLE IF EXISTS "audit_log" CASCADE;
DROP TABLE IF EXISTS "scheduled_scans" CASCADE;
DROP TABLE IF EXISTS "violation_triage" CASCADE;
DROP TABLE IF EXISTS "violations" CASCADE;
DROP TABLE IF EXISTS "scans" CASCADE;
DROP TABLE IF EXISTS "auth_profiles" CASCADE;
DROP TABLE IF EXISTS "sites" CASCADE;
DROP TABLE IF EXISTS "team_memberships" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "teams" CASCADE;
