import bcrypt from "bcryptjs";
import { z } from "zod";
import { closeDatabase, pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";

const recoveryInputSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(12).max(128)
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[0-9]/, "Password must include a number")
});

async function recoverAdministrator() {
  const input = recoveryInputSchema.parse({
    email: process.env.RECOVERY_ADMIN_EMAIL,
    password: process.env.RECOVERY_ADMIN_PASSWORD
  });

  await runMigrations();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const userResult = await client.query<{ id: string; email: string }>(
      `SELECT id, email
       FROM users
       WHERE email = $1 AND is_admin = TRUE AND account_type = 'staff' AND deleted_at IS NULL
       FOR UPDATE`,
      [input.email.toLowerCase()]
    );
    const administrator = userResult.rows[0];
    if (!administrator) {
      throw new Error("No administrator account matches RECOVERY_ADMIN_EMAIL");
    }

    await client.query(
      `UPDATE users
       SET password_hash = $2,
           is_active = TRUE,
           must_change_password = TRUE,
           password_changed_at = NOW(),
           auth_version = auth_version + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [administrator.id, passwordHash]
    );
    await client.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [administrator.id]
    );
    await client.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (NULL, 'administrator_local_recovery', $1::jsonb)`,
      [JSON.stringify({ targetUserId: administrator.id, email: administrator.email })]
    );
    await client.query("COMMIT");
    console.log(`Administrator recovery completed for ${administrator.email}.`);
    console.log("All existing sessions were revoked. Sign in and replace the temporary password immediately.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

recoverAdministrator()
  .catch((error) => {
    console.error("Administrator recovery failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
