-- Tighten the task/deliverable workflow without changing existing project data.

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS deliverable_required BOOLEAN NOT NULL DEFAULT FALSE;

-- A client account must never become part of the internal project team.
DELETE FROM project_team team
USING users member
WHERE member.id = team.user_id
  AND (
    member.account_type <> 'staff'
    OR member.is_active = FALSE
    OR member.deleted_at IS NOT NULL
  );

-- Task assignees are active internal team members (the project owner is implicit).
DELETE FROM task_assignees assignee
USING tasks task, projects project, users member
WHERE task.id = assignee.task_id
  AND project.id = task.project_id
  AND member.id = assignee.user_id
  AND (
    member.account_type <> 'staff'
    OR member.is_active = FALSE
    OR member.deleted_at IS NOT NULL
    OR (
      project.created_by <> member.id
      AND NOT EXISTS (
        SELECT 1
        FROM project_team team
        WHERE team.project_id = project.id
          AND team.user_id = member.id
          AND LOWER(team.role) IN ('manager', 'member')
      )
    )
  );

UPDATE tasks task
SET assigned_to = NULL,
    updated_at = NOW()
WHERE assigned_to IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM task_assignees assignee
    WHERE assignee.task_id = task.id
      AND assignee.user_id = task.assigned_to
  );

CREATE INDEX IF NOT EXISTS idx_tasks_deliverable_required
  ON tasks(project_id, deliverable_required)
  WHERE deleted_at IS NULL AND deliverable_required = TRUE;
