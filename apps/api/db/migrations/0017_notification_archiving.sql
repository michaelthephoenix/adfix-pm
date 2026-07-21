ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notifications_user_archived
  ON notifications(user_id, archived_at, created_at DESC);
