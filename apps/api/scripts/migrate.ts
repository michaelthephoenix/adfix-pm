import { closeDatabase } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";

runMigrations()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
