import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`adfix-api listening on port ${env.PORT}`);
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    try {
      await pool.end();
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
