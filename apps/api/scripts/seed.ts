import { closeDatabase } from "../src/db/pool.js";
import { seedDatabase, type SeedProfile } from "../src/db/seed.js";

function readSeedProfileArg(): SeedProfile | undefined {
  const profileArg = process.argv.find((arg) => arg.startsWith("--profile="));
  const value = profileArg?.split("=")[1];

  return value === "demo" || value === "admin_only" ? value : undefined;
}

seedDatabase(readSeedProfileArg())
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
