-- S-3: add KMS-encrypted DEK column to auth_profiles. Existing rows keep
-- their old direct-encrypted blob until rotated; new rows include the DEK.
-- Idempotent so a fresh DB whose init migration already includes this column
-- still applies cleanly.
ALTER TABLE "auth_profiles" ADD COLUMN IF NOT EXISTS "config_dek_cipher" BYTEA;
