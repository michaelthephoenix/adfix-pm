import { pool } from "../db/pool.js";

type ClientRow = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function listClients(input?: { page?: number; pageSize?: number }) {
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const [dataResult, countResult] = await Promise.all([
    pool.query<ClientRow>(
      `SELECT id, name, company, email, phone, notes, created_at, updated_at
       FROM clients
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM clients
       WHERE deleted_at IS NULL`
    )
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0)
  };
}

export async function getClientById(clientId: string) {
  const result = await pool.query<ClientRow>(
    `SELECT id, name, company, email, phone, notes, created_at, updated_at
     FROM clients
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [clientId]
  );

  return result.rows[0] ?? null;
}

export async function createClient(input: {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}) {
  const result = await pool.query<ClientRow>(
    `INSERT INTO clients (name, company, email, phone, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING id, name, company, email, phone, notes, created_at, updated_at`,
    [
      input.name,
      input.company ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.notes ?? null
    ]
  );

  return result.rows[0];
}

export async function updateClient(
  clientId: string,
  input: {
    name?: string;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
  }
) {
  const fields: string[] = [];
  const values: Array<string | null> = [];

  if (typeof input.name !== "undefined") {
    fields.push(`name = $${fields.length + 1}`);
    values.push(input.name);
  }
  if (typeof input.company !== "undefined") {
    fields.push(`company = $${fields.length + 1}`);
    values.push(input.company);
  }
  if (typeof input.email !== "undefined") {
    fields.push(`email = $${fields.length + 1}`);
    values.push(input.email);
  }
  if (typeof input.phone !== "undefined") {
    fields.push(`phone = $${fields.length + 1}`);
    values.push(input.phone);
  }
  if (typeof input.notes !== "undefined") {
    fields.push(`notes = $${fields.length + 1}`);
    values.push(input.notes);
  }

  if (fields.length === 0) {
    return getClientById(clientId);
  }

  fields.push("updated_at = NOW()");

  const result = await pool.query<ClientRow>(
    `UPDATE clients
     SET ${fields.join(", ")}
     WHERE id = $${fields.length} AND deleted_at IS NULL
     RETURNING id, name, company, email, phone, notes, created_at, updated_at`,
    [...values, clientId]
  );

  return result.rows[0] ?? null;
}

export async function deleteClient(clientId: string) {
  const result = await pool.query<{ id: string }>(
    `UPDATE clients
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [clientId]
  );

  return result.rowCount === 1;
}
