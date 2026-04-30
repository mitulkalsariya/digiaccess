-- S-18: row-level security on scans + violations.
--
-- Defence in depth: even if a future query handler forgets the team-scope
-- WHERE clause, the database refuses to return rows the caller can't see.
-- The API sets two session-local GUCs at the start of every transaction:
--   SET LOCAL app.user_id = '<uuid>'
--   SET LOCAL app.team_ids = '<uuid>,<uuid>,<uuid>'
-- Policies below read these GUCs to filter rows.

-- Helper that returns the current user's id (or NULL outside a request).
CREATE OR REPLACE FUNCTION app_current_user_id()
  RETURNS UUID
  LANGUAGE SQL STABLE
  AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::UUID;
  $$;

-- Helper returning the array of team UUIDs the current user belongs to.
CREATE OR REPLACE FUNCTION app_current_team_ids()
  RETURNS UUID[]
  LANGUAGE SQL STABLE
  AS $$
    SELECT CASE
      WHEN current_setting('app.team_ids', true) IS NULL OR current_setting('app.team_ids', true) = ''
      THEN ARRAY[]::UUID[]
      ELSE string_to_array(current_setting('app.team_ids', true), ',')::UUID[]
    END;
  $$;

-- Enable RLS on both tables and create allow-only-when-authorised policies.
ALTER TABLE "scans"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "violations" ENABLE ROW LEVEL SECURITY;

-- Service role (the API) bypasses RLS by default unless we force it.
ALTER TABLE "scans"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "violations" FORCE ROW LEVEL SECURITY;

-- scans: visible if creator or on the team, AND not private (creator override).
CREATE POLICY scans_select ON "scans"
  FOR SELECT USING (
    "created_by_id" = app_current_user_id()
    OR ("team_id" = ANY(app_current_team_ids()) AND "is_private" = false)
  );

-- scans: insertion allowed only as yourself.
CREATE POLICY scans_insert ON "scans"
  FOR INSERT WITH CHECK ("created_by_id" = app_current_user_id());

-- scans: updates only by creator.
CREATE POLICY scans_update ON "scans"
  FOR UPDATE USING ("created_by_id" = app_current_user_id())
  WITH CHECK ("created_by_id" = app_current_user_id());

-- scans: delete only by creator.
CREATE POLICY scans_delete ON "scans"
  FOR DELETE USING ("created_by_id" = app_current_user_id());

-- violations: inherit from parent scan.
CREATE POLICY violations_select ON "violations"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "scans" s
      WHERE s."id" = "violations"."scan_id"
        AND (
          s."created_by_id" = app_current_user_id()
          OR (s."team_id" = ANY(app_current_team_ids()) AND s."is_private" = false)
        )
    )
  );

CREATE POLICY violations_insert ON "violations"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM "scans" s
      WHERE s."id" = "violations"."scan_id"
        AND s."created_by_id" = app_current_user_id()
    )
  );

CREATE POLICY violations_update ON "violations"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM "scans" s
      WHERE s."id" = "violations"."scan_id"
        AND s."created_by_id" = app_current_user_id()
    )
  );

CREATE POLICY violations_delete ON "violations"
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM "scans" s
      WHERE s."id" = "violations"."scan_id"
        AND s."created_by_id" = app_current_user_id()
    )
  );
