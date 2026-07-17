import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { env } from "../config/env.js";

type EmbeddedDatabase = {
  database: PGlite;
  server: PGLiteSocketServer;
};

let embeddedDatabase: EmbeddedDatabase | null = null;
let closed = false;

async function createEmbeddedPool() {
  await mkdir(path.dirname(env.PGLITE_DATA_DIR), { recursive: true });
  const database = await PGlite.create(env.PGLITE_DATA_DIR, {
    extensions: { citext, pgcrypto }
  });
  const server = new PGLiteSocketServer({
    db: database,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 10
  });

  await server.start();
  embeddedDatabase = { database, server };

  console.log(`Using zero-config embedded database at ${env.PGLITE_DATA_DIR}`);

  return new Pool({
    connectionString: `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`,
    max: 5
  });
}

export const isEmbeddedDatabase = !env.DATABASE_URL;

export const pool = env.DATABASE_URL
  ? new Pool({ connectionString: env.DATABASE_URL })
  : await createEmbeddedPool();

export async function closeDatabase() {
  if (closed) return;
  closed = true;

  try {
    await pool.end();
  } finally {
    if (embeddedDatabase) {
      await embeddedDatabase.server.stop();
      await embeddedDatabase.database.close();
      embeddedDatabase = null;
    }
  }
}
