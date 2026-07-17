import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabase, isEmbeddedDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrations.js";
import { seedDatabase } from "./db/seed.js";

let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
let shuttingDown = false;

async function start() {
  if (isEmbeddedDatabase) {
    await runMigrations();
    await seedDatabase();
  }

  const app = createApp();
  server = app.listen(env.PORT, () => {
    console.log(`adfix-api listening on port ${env.PORT}`);
  });
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}. Starting graceful shutdown...`);

  if (!server) {
    await closeDatabase();
    process.exit(0);
  }

  server.close(async () => {
    try {
      await closeDatabase();
      console.log("HTTP server and database pool closed.");
      process.exit(0);
    } catch (error) {
      console.error("Error while closing database pool:", error);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("Graceful shutdown timed out; forcing process exit.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

start().catch(async (error) => {
  console.error("API startup failed:", error);
  await closeDatabase();
  process.exitCode = 1;
});
