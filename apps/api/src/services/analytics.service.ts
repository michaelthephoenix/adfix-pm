import { pool } from "../db/pool.js";

export async function getDashboardAnalytics() {
  const [projectsByPhase, overdueTasks, completedCounts] = await Promise.all([
    pool.query<{ phase: string; count: string }>(
      `SELECT current_phase AS phase, COUNT(*)::text AS count
       FROM projects
       WHERE deleted_at IS NULL
       GROUP BY current_phase`
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM tasks
       WHERE deleted_at IS NULL
         AND due_date IS NOT NULL
         AND due_date < CURRENT_DATE
         AND status <> 'completed'`
    ),
    pool.query<{ month_count: string; quarter_count: string }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE deleted_at IS NULL
             AND current_phase = 'delivery'
             AND updated_at >= DATE_TRUNC('month', NOW())
         )::text AS month_count,
         COUNT(*) FILTER (
           WHERE deleted_at IS NULL
             AND current_phase = 'delivery'
             AND updated_at >= DATE_TRUNC('quarter', NOW())
         )::text AS quarter_count
       FROM projects`
    )
  ]);

  return {
    projectsByPhase: projectsByPhase.rows.map((row) => ({
      phase: row.phase,
      count: Number(row.count)
    })),
    overdueTasksCount: Number(overdueTasks.rows[0]?.count ?? 0),
    projectsCompletedThisMonth: Number(completedCounts.rows[0]?.month_count ?? 0),
    projectsCompletedThisQuarter: Number(completedCounts.rows[0]?.quarter_count ?? 0)
  };
}

export async function getProjectsAnalytics() {
  const result = await pool.query<{
    project_id: string;
    project_name: string;
    current_phase: string;
    total_tasks: string;
    completed_tasks: string;
    completion_rate_pct: string;
  }>(
    `SELECT
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
     LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
     GROUP BY p.id, p.name, p.current_phase
     ORDER BY p.created_at DESC`
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

export async function getTeamAnalytics() {
  const result = await pool.query<{
    user_id: string;
    user_name: string;
    user_email: string;
    total_tasks: string;
    completed_tasks: string;
    overdue_tasks: string;
  }>(
    `SELECT
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
     LEFT JOIN tasks t ON t.assigned_to = u.id AND t.deleted_at IS NULL
     WHERE u.deleted_at IS NULL
       AND u.is_active = TRUE
     GROUP BY u.id, u.name, u.email
     ORDER BY u.name ASC`
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

export async function getTimelineAnalytics() {
  const result = await pool.query<{
    project_id: string;
    project_name: string;
    start_date: string;
    deadline: string;
    current_phase: string;
    days_remaining: string;
  }>(
    `SELECT
       p.id AS project_id,
       p.name AS project_name,
       p.start_date::text,
       p.deadline::text,
       p.current_phase,
       (p.deadline - CURRENT_DATE)::text AS days_remaining
     FROM projects p
     WHERE p.deleted_at IS NULL
     ORDER BY p.deadline ASC`
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

