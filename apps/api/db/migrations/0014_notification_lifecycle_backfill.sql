UPDATE notifications notification
SET action_required = TRUE
WHERE notification.action_required = FALSE
  AND (
    (
      notification.type = 'deliverable_internal_review_requested'
      AND EXISTS (
        SELECT 1
        FROM deliverable_versions version
        INNER JOIN deliverables deliverable ON deliverable.id = version.deliverable_id
        WHERE version.id::text = notification.metadata ->> 'versionId'
          AND deliverable.deleted_at IS NULL
          AND deliverable.status = 'internal_review'
      )
    )
    OR (
      notification.type = 'deliverable_internal_changes_requested'
      AND EXISTS (
        SELECT 1 FROM deliverables deliverable
        WHERE deliverable.id::text = notification.metadata ->> 'deliverableId'
          AND deliverable.deleted_at IS NULL
          AND deliverable.status = 'internal_changes_requested'
      )
    )
    OR (
      notification.type = 'deliverable_client_review_requested'
      AND EXISTS (
        SELECT 1
        FROM deliverable_versions version
        INNER JOIN deliverables deliverable ON deliverable.id = version.deliverable_id
        WHERE version.id::text = notification.metadata ->> 'versionId'
          AND version.client_submitted_at IS NOT NULL
          AND version.client_withdrawn_at IS NULL
          AND deliverable.deleted_at IS NULL
          AND deliverable.status = 'in_review'
      )
    )
    OR (
      notification.type = 'deliverable_changes_requested'
      AND EXISTS (
        SELECT 1 FROM deliverables deliverable
        WHERE deliverable.id::text = notification.metadata ->> 'deliverableId'
          AND deliverable.deleted_at IS NULL
          AND deliverable.status = 'changes_requested'
      )
    )
    OR (
      notification.type = 'deliverable_client_message'
      AND EXISTS (
        SELECT 1 FROM deliverables deliverable
        WHERE deliverable.id::text = notification.metadata ->> 'deliverableId'
          AND deliverable.deleted_at IS NULL
          AND deliverable.status IN ('in_review', 'changes_requested')
      )
    )
    OR (
      notification.type IN ('task_assigned', 'client_feedback_forwarded')
      AND EXISTS (
        SELECT 1
        FROM tasks task
        WHERE task.id = notification.task_id
          AND task.deleted_at IS NULL
          AND task.status <> 'completed'
          AND (
            task.assigned_to = notification.user_id
            OR EXISTS (
              SELECT 1 FROM task_assignees assignment
              WHERE assignment.task_id = task.id AND assignment.user_id = notification.user_id
            )
          )
      )
    )
  );
