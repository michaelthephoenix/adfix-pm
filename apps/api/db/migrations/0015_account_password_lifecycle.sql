ALTER TABLE users
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN password_changed_at TIMESTAMPTZ,
  ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET password_changed_at = COALESCE(updated_at, created_at)
WHERE password_changed_at IS NULL;

ALTER TABLE users
  ALTER COLUMN password_changed_at SET DEFAULT NOW(),
  ALTER COLUMN password_changed_at SET NOT NULL;
