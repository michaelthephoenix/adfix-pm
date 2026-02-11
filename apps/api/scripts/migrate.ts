import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/pool.js";

type MigrationFile = {
  name: string;
  fullPath: string;
};

function getMigrationsDir() {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  return path.resolve(currentDir, "../db/migrations");
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listMigrationFiles(): Promise<MigrationFile[]> {
  const migrationsDir = getMigrationsDir();
  const entries = await readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(migrationsDir, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getAppliedMigrationSet(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations ORDER BY filename ASC`
  );

  return new Set(result.rows.map((row) => row.filename));
}

async function applyMigration(file: MigrationFile) {
  const sql = await readFile(file.fullPath, "utf-8");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file.name]);
    await client.query("COMMIT");
    console.log(`Applied migration: ${file.name}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function run() {
  await ensureMigrationsTable();

  const files = await listMigrationFiles();
  const applied = await getAppliedMigrationSet();

  const pending = files.filter((file) => !applied.has(file.name));
  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  for (const file of pending) {
    await applyMigration(file);
  }

  console.log(`Migration complete. Applied ${pending.length} migration(s).`);
}

run()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
