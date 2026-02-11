import bcrypt from "bcryptjs";
import { env } from "../src/config/env.js";
import { pool } from "../src/db/pool.js";

const seedAdminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@adfix.local";
const seedAdminName = process.env.SEED_ADMIN_NAME ?? "Adfix Admin";
const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

async function ensureAdminUser() {
  const passwordHash = await bcrypt.hash(seedAdminPassword, 12);

  await pool.query(
    `
    INSERT INTO users (email, name, password_hash, is_active)
    VALUES ($1, $2, $3, TRUE)
    ON CONFLICT (email)
    DO UPDATE
      SET name = EXCLUDED.name,
          password_hash = EXCLUDED.password_hash,
          is_active = TRUE,
          deleted_at = NULL,
          updated_at = NOW()
    `,
    [seedAdminEmail, seedAdminName, passwordHash]
  );

  console.log(`Seeded admin user: ${seedAdminEmail}`);
}

async function run() {
  // Access env to fail fast if required config is missing.
  void env.DATABASE_URL;

  await ensureAdminUser();
}

run()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
