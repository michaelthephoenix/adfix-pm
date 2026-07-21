ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS action_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS action_status VARCHAR(20) NOT NULL DEFAULT 'open';

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS resolution_reason VARCHAR(100);

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(255);

ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_action_status_check;

ALTER TABLE notifications
ADD CONSTRAINT notifications_action_status_check
CHECK (action_status IN ('open', 'resolved', 'superseded'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
  ON notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_action_status
  ON notifications(user_id, action_required, action_status, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key VARCHAR(255) NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
  ON notification_outbox(status, available_at, created_at)
  WHERE status IN ('pending', 'failed');

WITH duplicate_pending AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY client_id, LOWER(email::text)
      ORDER BY created_at DESC, id DESC
    ) AS duplicate_rank
  FROM client_invitations
  WHERE accepted_at IS NULL AND revoked_at IS NULL
)
UPDATE client_invitations invitation
SET revoked_at = NOW()
FROM duplicate_pending duplicate
WHERE invitation.id = duplicate.id AND duplicate.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_invitations_one_pending
  ON client_invitations(client_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
