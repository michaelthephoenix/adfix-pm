-- Add global admin capability for user/admin control endpoints.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_team_user_project ON project_team(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_log_action_created ON activity_log(action, created_at DESC);
