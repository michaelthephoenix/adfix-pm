import { pool } from "../db/pool.js";

const ACCESSIBLE_PROJECTS_CTE = `
  WITH accessible_projects AS (
    SELECT p.id, p.name, p.current_phase, p.updated_at, p.deadline, p.client_id,
      c.name AS client_name,
      (
        p.created_by = $1
        OR EXISTS (
          SELECT 1 FROM project_team supervisor_team
          WHERE supervisor_team.project_id = p.id
            AND supervisor_team.user_id = $1
            AND LOWER(supervisor_team.role) IN ('owner', 'manager')
        )
      ) AS is_supervisor
    FROM projects p
    INNER JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
    LEFT JOIN project_team pt
      ON pt.project_id = p.id
     AND pt.user_id = $1
    WHERE p.deleted_at IS NULL
      AND (p.created_by = $1 OR pt.user_id IS NOT NULL)
  )
`;

export async function getDashboardAnalytics(userId: string) {
  const [
    projectsByPhase,
    overdueTasks,
    completedCounts,
    internalReviews,
    clientFeedback,
    dueTodayAssignments,
    blockedTasks,
    unresolvedClientReviews,
    workload
  ] = await Promise.all([
    pool.query<{ phase: string; count: string }>(
      `${ACCESSIBLE_PROJECTS_CTE}
       SELECT current_phase AS phase, COUNT(*)::text AS count
       FROM accessible_projects
       GROUP BY current_phase`,
      [userId]
    ),
    pool.query<{ count: string }>(
      `${ACCESSIBLE_PROJECTS_CTE}
       SELECT COUNT(*)::text AS count
       FROM tasks t
       INNER JOIN accessible_projects ap ON ap.id = t.project_id
       WHERE t.deleted_at IS NULL
         AND t.due_date IS NOT NULL
         AND t.due_date < CURRENT_DATE
         AND t.status <> 'completed'`,
      [userId]
    ),
    pool.query<{ month_count: string; quarter_count: string }>(
      `${ACCESSIBLE_PROJECTS_CTE}
       SELECT
         COUNT(*) FILTER (
           WHERE current_phase = 'delivery'
             AND updated_at >= DATE_TRUNC('month', NOW())
         )::text AS month_count,
         COUNT(*) FILTER (
           WHERE current_phase = 'delivery'
             AND updated_at >= DATE_TRUNC('quarter', NOW())
         )::text AS quarter_count
       FROM accessible_projects`,
      [userId]
    ),
    pool.query<{
      version_id: string; deliverable_id: string; deliverable_title: string;
      project_id: string; project_name: string; client_name: string;
      version_number: number; submitted_at: Date; submitted_by_name: string; total_count: string;
    }>(
      `${ACCESSIBLE_PROJECTS_CTE}
       SELECT version.id AS version_id, deliverable.id AS deliverable_id,
         deliverable.title AS deliverable_title, project.id AS project_id,
         project.name AS project_name, project.client_name,
         version.version_number, version.submitted_at, submitter.name AS submitted_by_name,
         COUNT(*) OVER()::text AS total_count
       FROM deliverables deliverable
       INNER JOIN accessible_projects project ON project.id = deliverable.project_id
       INNER JOIN deliverable_versions version ON version.deliverable_id = deliverable.id
       INNER JOIN users submitter ON submitter.id = version.submitted_by
       WHERE project.is_supervisor = TRUE
         AND project.current_phase <> 'delivery'
         AND deliverable.deleted_at IS NULL
         AND deliverable.status = 'internal_review'
         AND version.id = (
           SELECT latest.id FROM deliverable_versions latest
           WHERE latest.deliverable_id = deliverable.id
           ORDER BY latest.version_number DESC LIMIT 1
         )
       ORDER BY version.submitted_at ASC
       LIMIT 8`,
      [userId]
    ),
    pool.query<{
      notification_id: string; notification_type: string; title: string; message: string;
      created_at: Date; version_id: string; deliverable_id: string;
      deliverable_title: string; project_id: string; project_name: string; client_name: string; total_count: string;
    }>(
      `${ACCESSIBLE_PROJECTS_CTE}
       SELECT latest_feedback.*, COUNT(*) OVER()::text AS total_count FROM (
         SELECT DISTINCT ON (notification.metadata ->> 'versionId')
           notification.id AS notification_id, notification.type AS notification_type,
           notification.title, notification.message, notification.created_at,
           version.id AS version_id, deliverable.id AS deliverable_id,
           deliverable.title AS deliverable_title, project.id AS project_id,
           project.name AS project_name, project.client_name
         FROM notifications notification
         INNER JOIN accessible_projects project ON project.id = notification.project_id
         INNER JOIN deliverables deliverable
           ON deliverable.id::text = notification.metadata ->> 'deliverableId'
           AND deliverable.deleted_at IS NULL
         INNER JOIN deliverable_versions version
           ON version.id::text = notification.metadata ->> 'versionId'
           AND version.deliverable_id = deliverable.id
         WHERE notification.user_id = $1
           AND project.is_supervisor = TRUE
           AND project.current_phase <> 'delivery'
           AND notification.action_required = TRUE
           AND notification.action_status = 'open'
           AND notification.archived_at IS NULL
           AND notification.type IN ('deliverable_changes_requested', 'deliverable_client_message')
         ORDER BY notification.metadata ->> 'versionId', notification.created_at DESC
       ) latest_feedback
       ORDER BY created_at ASC
       LIMIT 8`,
      [userId]
    ),
    pool.query<{
      id: string; title: string; priority: string; due_date: string;
      project_id: string; project_name: string; client_name: string;
      assignees: Array<{ id: string; name: string; avatarUrl: string | null }>; total_count: string;
    }>(
      `${ACCESSIBLE_PROJECTS_CTE}
       SELECT task.id, task.title, task.priority, task.due_date::text,
         project.id AS project_id, project.name AS project_name, project.client_name,
         COALESCE(
           json_agg(json_build_object('id', member.id, 'name', member.name, 'avatarUrl', member.avatar_url))
             FILTER (WHERE member.id IS NOT NULL),
           '[]'::json
         ) AS assignees,
         COUNT(*) OVER()::text AS total_count
       FROM tasks task
       INNER JOIN accessible_projects project ON project.id = task.project_id
       LEFT JOIN task_assignees assignment ON assignment.task_id = task.id
       LEFT JOIN users member ON member.id = assignment.user_id AND member.deleted_at IS NULL
       WHERE task.deleted_at IS NULL
         AND project.current_phase <> 'delivery'
         AND task.status <> 'completed'
         AND task.due_date = CURRENT_DATE
       GROUP BY task.id, task.title, task.priority, task.due_date,
         project.id, project.name, project.client_name
       ORDER BY task.priority DESC, task.created_at ASC
       LIMIT 8`,
      [userId]
    ),
    pool.query<{
      id: string; title: string; priority: string; due_date: string | null;
      project_id: string; project_name: string; client_name: string;
      assignees: Array<{ id: string; name: string; avatarUrl: string | null }>; total_count: string;
    }>(
      `${ACCESSIBLE_PROJECTS_CTE}
       SELECT task.id, task.title, task.priority, task.due_date::text,
         project.id AS project_id, project.name AS project_name, project.client_name,
         COALESCE(
           json_agg(json_build_object('id', member.id, 'name', member.name, 'avatarUrl', member.avatar_url))
             FILTER (WHERE member.id IS NOT NULL),
           '[]'::json
         ) AS assignees,
         COUNT(*) OVER()::text AS total_count
       FROM tasks task
       INNER JOIN accessible_projects project ON project.id = task.project_id
       LEFT JOIN task_assignees assignment ON assignment.task_id = task.id
       LEFT JOIN users member ON member.id = assignment.user_id AND member.deleted_at IS NULL
       WHERE task.deleted_at IS NULL AND task.status = 'blocked'
         AND project.current_phase <> 'delivery'
       GROUP BY task.id, task.title, task.priority, task.due_date,
         project.id, project.name, project.client_name
       ORDER BY task.updated_at ASC
       LIMIT 8`,
      [userId]
    ),
    pool.query<{
      version_id: string; deliverable_id: string; deliverable_title: string;
      project_id: string; project_name: string; client_name: string;
      version_number: number; client_submitted_at: Date; total_count: string;
    }>(
      `${ACCESSIBLE_PROJECTS_CTE}
       SELECT version.id AS version_id, deliverable.id AS deliverable_id,
         deliverable.title AS deliverable_title, project.id AS project_id,
         project.name AS project_name, project.client_name,
         version.version_number, version.client_submitted_at,
         COUNT(*) OVER()::text AS total_count
       FROM deliverables deliverable
       INNER JOIN accessible_projects project ON project.id = deliverable.project_id
       INNER JOIN deliverable_versions version ON version.deliverable_id = deliverable.id
       WHERE project.is_supervisor = TRUE
         AND project.current_phase <> 'delivery'
         AND deliverable.deleted_at IS NULL
         AND deliverable.status = 'in_review'
         AND version.client_submitted_at IS NOT NULL
         AND version.client_withdrawn_at IS NULL
         AND version.id = (
           SELECT latest.id FROM deliverable_versions latest
           WHERE latest.deliverable_id = deliverable.id
           ORDER BY latest.version_number DESC LIMIT 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM deliverable_reviews review
           WHERE review.deliverable_version_id = version.id
         )
       ORDER BY version.client_submitted_at ASC
       LIMIT 8`,
      [userId]
    ),
    pool.query<{
      user_id: string; user_name: string; avatar_url: string | null;
      active_tasks: string; due_today: string; overdue_tasks: string; blocked_tasks: string;
    }>(
      `${ACCESSIBLE_PROJECTS_CTE},
       project_members AS (
         SELECT project.id AS project_id, owner.id AS user_id
         FROM accessible_projects project
         INNER JOIN projects source_project ON source_project.id = project.id
         INNER JOIN users owner ON owner.id = source_project.created_by
         WHERE project.current_phase <> 'delivery'
         UNION
         SELECT project.id, team.user_id
         FROM accessible_projects project
         INNER JOIN project_team team ON team.project_id = project.id
         WHERE project.current_phase <> 'delivery'
       )
       SELECT member.id AS user_id, member.name AS user_name, member.avatar_url,
         COUNT(DISTINCT task.id) FILTER (WHERE task.status <> 'completed')::text AS active_tasks,
         COUNT(DISTINCT task.id) FILTER (WHERE task.status <> 'completed' AND task.due_date = CURRENT_DATE)::text AS due_today,
         COUNT(DISTINCT task.id) FILTER (WHERE task.status <> 'completed' AND task.due_date < CURRENT_DATE)::text AS overdue_tasks,
         COUNT(DISTINCT task.id) FILTER (WHERE task.status = 'blocked')::text AS blocked_tasks
       FROM project_members membership
       INNER JOIN users member ON member.id = membership.user_id
         AND member.deleted_at IS NULL AND member.is_active = TRUE AND member.account_type = 'staff'
       LEFT JOIN task_assignees assignment ON assignment.user_id = member.id
       LEFT JOIN tasks task ON task.id = assignment.task_id
         AND task.project_id = membership.project_id AND task.deleted_at IS NULL
       GROUP BY member.id, member.name, member.avatar_url
       ORDER BY
         COUNT(DISTINCT task.id) FILTER (WHERE task.status = 'blocked') DESC,
         COUNT(DISTINCT task.id) FILTER (WHERE task.status <> 'completed' AND task.due_date < CURRENT_DATE) DESC,
         COUNT(DISTINCT task.id) FILTER (WHERE task.status <> 'completed') DESC,
         member.name ASC
       LIMIT 8`,
      [userId]
    )
  ]);

  return {
    projectsByPhase: projectsByPhase.rows.map((row) => ({
      phase: row.phase,
      count: Number(row.count)
    })),
    overdueTasksCount: Number(overdueTasks.rows[0]?.count ?? 0),
    projectsCompletedThisMonth: Number(completedCounts.rows[0]?.month_count ?? 0),
    projectsCompletedThisQuarter: Number(completedCounts.rows[0]?.quarter_count ?? 0),
    attentionCounts: {
      internalReviews: Number(internalReviews.rows[0]?.total_count ?? 0),
      clientFeedback: Number(clientFeedback.rows[0]?.total_count ?? 0),
      dueToday: Number(dueTodayAssignments.rows[0]?.total_count ?? 0),
      blockedTasks: Number(blockedTasks.rows[0]?.total_count ?? 0),
      unresolvedClientReviews: Number(unresolvedClientReviews.rows[0]?.total_count ?? 0)
    },
    internalReviewsAwaitingDecision: internalReviews.rows.map((row) => ({
      versionId: row.version_id,
      deliverableId: row.deliverable_id,
      deliverableTitle: row.deliverable_title,
      projectId: row.project_id,
      projectName: row.project_name,
      clientName: row.client_name,
      versionNumber: row.version_number,
      submittedAt: row.submitted_at,
      submittedByName: row.submitted_by_name
    })),
    clientFeedbackAwaitingResponse: clientFeedback.rows.map((row) => ({
      notificationId: row.notification_id,
      type: row.notification_type,
      title: row.title,
      message: row.message,
      createdAt: row.created_at,
      versionId: row.version_id,
      deliverableId: row.deliverable_id,
      deliverableTitle: row.deliverable_title,
      projectId: row.project_id,
      projectName: row.project_name,
      clientName: row.client_name
    })),
    dueTodayAssignments: dueTodayAssignments.rows.map((row) => ({
      id: row.id,
      title: row.title,
      priority: row.priority,
      dueDate: row.due_date,
      projectId: row.project_id,
      projectName: row.project_name,
      clientName: row.client_name,
      assignees: row.assignees
    })),
    blockedTasks: blockedTasks.rows.map((row) => ({
      id: row.id,
      title: row.title,
      priority: row.priority,
      dueDate: row.due_date,
      projectId: row.project_id,
      projectName: row.project_name,
      clientName: row.client_name,
      assignees: row.assignees
    })),
    unresolvedClientReviews: unresolvedClientReviews.rows.map((row) => ({
      versionId: row.version_id,
      deliverableId: row.deliverable_id,
      deliverableTitle: row.deliverable_title,
      projectId: row.project_id,
      projectName: row.project_name,
      clientName: row.client_name,
      versionNumber: row.version_number,
      clientSubmittedAt: row.client_submitted_at
    })),
    workload: workload.rows.map((row) => ({
      userId: row.user_id,
      userName: row.user_name,
      avatarUrl: row.avatar_url,
      activeTasks: Number(row.active_tasks),
      dueToday: Number(row.due_today),
      overdueTasks: Number(row.overdue_tasks),
      blockedTasks: Number(row.blocked_tasks)
    }))
  };
}

export async function getProjectsAnalytics(userId: string) {
  const result = await pool.query<{
    project_id: string;
    project_name: string;
    current_phase: string;
    total_tasks: string;
    completed_tasks: string;
    completion_rate_pct: string;
  }>(
    `${ACCESSIBLE_PROJECTS_CTE}
     SELECT
       p.id AS project_id,
       p.name AS project_name,
       p.current_phase,
       COUNT(t.id)::text AS total_tasks,
       COUNT(t.id) FILTER (WHERE t.status = 'completed')::text AS completed_tasks,
       CASE
         WHEN COUNT(t.id) = 0 THEN '0'
         ELSE ROUND((COUNT(t.id) FILTER (WHERE t.status = 'completed')::numeric / COUNT(t.id)::numeric) * 100, 2)::text
       END AS completion_rate_pct
     FROM projects p
     INNER JOIN accessible_projects ap ON ap.id = p.id
     LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
     GROUP BY p.id, p.name, p.current_phase
     ORDER BY p.created_at DESC`,
    [userId]
  );

  return result.rows.map((row) => ({
    projectId: row.project_id,
    projectName: row.project_name,
    currentPhase: row.current_phase,
    totalTasks: Number(row.total_tasks),
    completedTasks: Number(row.completed_tasks),
    completionRatePct: Number(row.completion_rate_pct)
  }));
}

export async function getTeamAnalytics(userId: string) {
  const result = await pool.query<{
    user_id: string;
    user_name: string;
    user_email: string;
    total_tasks: string;
    completed_tasks: string;
    overdue_tasks: string;
  }>(
    `${ACCESSIBLE_PROJECTS_CTE}
     SELECT
       u.id AS user_id,
       u.name AS user_name,
       u.email AS user_email,
       COUNT(t.id)::text AS total_tasks,
       COUNT(t.id) FILTER (WHERE t.status = 'completed')::text AS completed_tasks,
       COUNT(t.id) FILTER (
         WHERE t.status <> 'completed'
           AND t.due_date IS NOT NULL
           AND t.due_date < CURRENT_DATE
       )::text AS overdue_tasks
     FROM users u
     LEFT JOIN task_assignees ta ON ta.user_id = u.id
     LEFT JOIN tasks t ON t.id = ta.task_id AND t.deleted_at IS NULL
     LEFT JOIN accessible_projects ap ON ap.id = t.project_id
     WHERE u.deleted_at IS NULL
       AND u.is_active = TRUE
       AND (t.id IS NULL OR ap.id IS NOT NULL)
     GROUP BY u.id, u.name, u.email
     ORDER BY u.name ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    totalTasks: Number(row.total_tasks),
    completedTasks: Number(row.completed_tasks),
    overdueTasks: Number(row.overdue_tasks)
  }));
}

export async function getTimelineAnalytics(userId: string) {
  const result = await pool.query<{
    project_id: string;
    project_name: string;
    start_date: string;
    deadline: string;
    current_phase: string;
    days_remaining: string;
  }>(
    `${ACCESSIBLE_PROJECTS_CTE}
     SELECT
       p.id AS project_id,
       p.name AS project_name,
       p.start_date::text,
       p.deadline::text,
       p.current_phase,
       (p.deadline - CURRENT_DATE)::text AS days_remaining
     FROM projects p
     INNER JOIN accessible_projects ap ON ap.id = p.id
     ORDER BY p.deadline ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    projectId: row.project_id,
    projectName: row.project_name,
    startDate: row.start_date,
    deadline: row.deadline,
    currentPhase: row.current_phase,
    daysRemaining: Number(row.days_remaining)
  }));
}
