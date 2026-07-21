ALTER TABLE auth_sessions
  ADD COLUMN token_family_id UUID,
  ADD COLUMN replaced_by_session_id UUID,
  ADD COLUMN reuse_detected_at TIMESTAMPTZ;

UPDATE auth_sessions
SET token_family_id = id
WHERE token_family_id IS NULL;

ALTER TABLE auth_sessions
  ALTER COLUMN token_family_id SET NOT NULL,
  ADD CONSTRAINT auth_sessions_replaced_by_fk
    FOREIGN KEY (replaced_by_session_id)
    REFERENCES auth_sessions(id)
    ON DELETE SET NULL;

CREATE INDEX idx_auth_sessions_family_active
  ON auth_sessions(token_family_id)
  WHERE revoked_at IS NULL;
