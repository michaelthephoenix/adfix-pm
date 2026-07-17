import { runMigrations } from "../src/db/migrations.js";
import { closeDatabase, pool } from "../src/db/pool.js";
import { seedDatabase } from "../src/db/seed.js";

async function run() {
  await runMigrations();
  await pool.query(`TRUNCATE TABLE
    notifications, deliverable_reviews, deliverable_versions, deliverables,
    client_invitations, client_memberships, activity_log, project_team,
    task_comments, files, tasks, projects, auth_sessions, clients, users
    RESTART IDENTITY CASCADE`);
  await seedDatabase("demo");
  console.log("Local prototype reset to the full demonstration journey.");
}

run().catch((error) => {
  console.error("Demo reset failed:", error);
  process.exitCode = 1;
}).finally(closeDatabase);
