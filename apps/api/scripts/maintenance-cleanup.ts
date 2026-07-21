import { pool, closeDatabase } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { storageProvider } from "../src/storage/local-storage.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

function positiveDays(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return value;
}

async function cleanupLocalObjects(olderThan: Date) {
  const result = await pool.query<{ object_key: string }>(
    `SELECT object_key
     FROM files
     WHERE storage_type = 'local'
       AND deleted_at IS NOT NULL
       AND deleted_at < $1`,
    [olderThan]
  );

  const outcomes = await Promise.allSettled(
    result.rows.map((file) => storageProvider.delete(file.object_key))
  );
  const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
  return { selected: result.rowCount ?? 0, failed };
}

async function main() {
  await runMigrations();
  const now = Date.now();
  const sessionRetention = new Date(now - positiveDays("AUTH_SESSION_RETENTION_DAYS", 30) * DAY_MS);
  const invitationRetention = new Date(now - positiveDays("INVITATION_RETENTION_DAYS", 90) * DAY_MS);
  const notificationRetention = new Date(now - positiveDays("NOTIFICATION_RETENTION_DAYS", 180) * DAY_MS);
  const storageRetention = new Date(now - positiveDays("DELETED_FILE_RETENTION_DAYS", 7) * DAY_MS);

  const localObjects = await cleanupLocalObjects(storageRetention);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sessions = await client.query(
      `DELETE FROM auth_sessions
       WHERE COALESCE(revoked_at, expires_at) < $1`,
      [sessionRetention]
    );
    const invitations = await client.query(
      `DELETE FROM client_invitations
       WHERE created_at < $1
         AND (accepted_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at < NOW())`,
      [invitationRetention]
    );
    const notifications = await client.query(
      `DELETE FROM notifications
       WHERE created_at < $1
         AND (archived_at IS NOT NULL OR action_status IN ('resolved', 'superseded'))`,
      [notificationRetention]
    );
    const outbox = await client.query(
      `DELETE FROM notification_outbox
       WHERE status = 'completed'
         AND processed_at < $1`,
      [sessionRetention]
    );
    const mutationKeys = await client.query(
      `DELETE FROM workflow_mutation_keys
       WHERE created_at < NOW() - INTERVAL '7 days'`
    );
    await client.query("COMMIT");

    console.log(JSON.stringify({
      authSessionsDeleted: sessions.rowCount ?? 0,
      invitationsDeleted: invitations.rowCount ?? 0,
      notificationsDeleted: notifications.rowCount ?? 0,
      outboxEventsDeleted: outbox.rowCount ?? 0,
      mutationKeysDeleted: mutationKeys.rowCount ?? 0,
      localObjectsSelected: localObjects.selected,
      localObjectFailures: localObjects.failed
    }, null, 2));

    if (localObjects.failed > 0) process.exitCode = 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error("Maintenance cleanup failed", error);
    process.exitCode = 1;
  })
  .finally(async () => closeDatabase());
