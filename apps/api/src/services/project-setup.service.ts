import { pool } from "../db/pool.js";
import {
  dispatchNotificationOutboxEvent,
  enqueueNotificationEvent
} from "./notifications.service.js";

export type ProjectSetupInput = {
  clientId?: string;
  newClient?: {
    name: string;
    company?: string | null;
  };
  name: string;
  description?: string | null;
  priority?: "low" | "medium" | "high" | "urgent";
  budget?: string | null;
  startDate: string;
  deadline: string;
  createdBy: string;
  team: Array<{
    userId: string;
    role: "manager" | "member" | "viewer";
  }>;
};

type ProjectSetupRow = {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  current_phase: "client_acquisition";
  priority: "low" | "medium" | "high" | "urgent";
  budget: string | null;
  start_date: string;
  deadline: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

export type ProjectSetupResult =
  | {
      ok: true;
      project: ProjectSetupRow;
      clientCreated: boolean;
      teamUserIds: string[];
    }
  | { ok: false; reason: "client_not_found" }
  | { ok: false; reason: "invalid_team_members"; userIds: string[] };

export async function createProjectSetup(input: ProjectSetupInput): Promise<ProjectSetupResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let clientId = input.clientId;
    let clientCreated = false;
    if (input.newClient) {
      const createdClient = await client.query<{ id: string }>(
        `INSERT INTO clients (name, company, email, phone, notes, created_at, updated_at)
         VALUES ($1, $2, NULL, NULL, NULL, NOW(), NOW())
         RETURNING id`,
        [input.newClient.name, input.newClient.company ?? null]
      );
      clientId = createdClient.rows[0].id;
      clientCreated = true;
    } else {
      const existingClient = await client.query<{ id: string }>(
        `SELECT id FROM clients WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [clientId]
      );
      if (!existingClient.rows[0]) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "client_not_found" };
      }
    }

    const uniqueTeam = [...new Map(
      input.team
        .filter((assignment) => assignment.userId !== input.createdBy)
        .map((assignment) => [assignment.userId, assignment])
    ).values()];
    const teamUserIds = uniqueTeam.map((assignment) => assignment.userId);

    if (teamUserIds.length > 0) {
      const validUsers = await client.query<{ id: string }>(
        `SELECT id
         FROM users
         WHERE id = ANY($1::uuid[])
           AND deleted_at IS NULL
           AND is_active = TRUE
           AND account_type = 'staff'`,
        [teamUserIds]
      );
      const validIds = new Set(validUsers.rows.map((user) => user.id));
      const invalidIds = teamUserIds.filter((userId) => !validIds.has(userId));
      if (invalidIds.length > 0) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "invalid_team_members", userIds: invalidIds };
      }
    }

    const projectResult = await client.query<ProjectSetupRow>(
      `INSERT INTO projects (
         client_id, name, description, current_phase, priority, budget,
         start_date, deadline, created_by, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'client_acquisition', $4, NULLIF($5, '')::numeric, $6::date, $7::date, $8, NOW(), NOW())
       RETURNING id, client_id, name, description, current_phase, priority, budget,
         start_date, deadline, created_by, created_at, updated_at`,
      [
        clientId,
        input.name,
        input.description ?? null,
        input.priority ?? "medium",
        input.budget ?? null,
        input.startDate,
        input.deadline,
        input.createdBy
      ]
    );
    const project = projectResult.rows[0];

    for (const assignment of uniqueTeam) {
      await client.query(
        `INSERT INTO project_team (project_id, user_id, role, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [project.id, assignment.userId, assignment.role]
      );
    }

    await client.query(
      `INSERT INTO activity_log (project_id, user_id, action, details, client_visible, created_at)
       VALUES ($1, $2, 'project_created', $3::jsonb, FALSE, NOW())`,
      [
        project.id,
        input.createdBy,
        JSON.stringify({
          projectId: project.id,
          clientId: project.client_id,
          currentPhase: project.current_phase,
          initialTeam: uniqueTeam
        })
      ]
    );

    const notificationEventKeys: string[] = [];
    for (const assignment of uniqueTeam) {
      const eventKey = `project:${project.id}:team:${assignment.userId}:assigned`;
      notificationEventKeys.push(eventKey);
      await enqueueNotificationEvent(
        client,
        eventKey,
        [assignment.userId],
        {
          projectId: project.id,
          type: "project_team_assigned",
          title: "Added to project",
          message: `You were added to project "${project.name}" as ${assignment.role}.`,
          metadata: {
            projectId: project.id,
            role: assignment.role,
            addedByUserId: input.createdBy,
            href: `/projects/${project.id}?tab=tasks`
          },
          actionRequired: false
        }
      );
    }

    await client.query("COMMIT");
    await Promise.all(notificationEventKeys.map((eventKey) =>
      dispatchNotificationOutboxEvent(eventKey).catch((error) => {
        console.error(`Project setup notification ${eventKey} was queued for retry:`, error);
      })
    ));
    return { ok: true, project, clientCreated, teamUserIds };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
