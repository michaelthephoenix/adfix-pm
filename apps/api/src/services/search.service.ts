import { pool } from "../db/pool.js";

export type SearchScope = "all" | "projects" | "tasks" | "files" | "clients";

type SearchResultItem = {
  id: string;
  type: "project" | "task" | "file" | "client";
  title: string;
  subtitle: string | null;
  projectId: string | null;
  clientId: string | null;
  matchedOn: string;
};

type SearchResult = {
  projects: SearchResultItem[];
  tasks: SearchResultItem[];
  files: SearchResultItem[];
  clients: SearchResultItem[];
};

async function searchProjects(term: string, limit: number): Promise<SearchResultItem[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    client_id: string;
    client_name: string;
    current_phase: string;
  }>(
    `SELECT
       p.id,
       p.name,
       p.client_id,
       c.name AS client_name,
       p.current_phase
     FROM projects p
     INNER JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
       AND (
         p.name ILIKE $1
         OR COALESCE(p.description, '') ILIKE $1
         OR c.name ILIKE $1
       )
     ORDER BY p.updated_at DESC
     LIMIT $2`,
    [term, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: "project",
    title: row.name,
    subtitle: `${row.client_name} · ${row.current_phase}`,
    projectId: row.id,
    clientId: row.client_id,
    matchedOn: "name|description|client"
  }));
}

async function searchTasks(term: string, limit: number): Promise<SearchResultItem[]> {
  const result = await pool.query<{
    id: string;
    project_id: string;
    title: string;
    status: string;
    phase: string;
  }>(
    `SELECT
       t.id,
       t.project_id,
       t.title,
       t.status,
       t.phase
     FROM tasks t
     WHERE t.deleted_at IS NULL
       AND (
         t.title ILIKE $1
         OR COALESCE(t.description, '') ILIKE $1
       )
     ORDER BY t.updated_at DESC
     LIMIT $2`,
    [term, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: "task",
    title: row.title,
    subtitle: `${row.phase} · ${row.status}`,
    projectId: row.project_id,
    clientId: null,
    matchedOn: "title|description"
  }));
}

async function searchFiles(term: string, limit: number): Promise<SearchResultItem[]> {
  const result = await pool.query<{
    id: string;
    project_id: string;
    file_name: string;
    file_type: string;
    storage_type: string;
  }>(
    `SELECT
       f.id,
       f.project_id,
       f.file_name,
       f.file_type,
       f.storage_type
     FROM files f
     WHERE f.deleted_at IS NULL
       AND (
         f.file_name ILIKE $1
         OR f.file_type::text ILIKE $1
       )
     ORDER BY f.created_at DESC
     LIMIT $2`,
    [term, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: "file",
    title: row.file_name,
    subtitle: `${row.file_type} · ${row.storage_type}`,
    projectId: row.project_id,
    clientId: null,
    matchedOn: "file_name|file_type"
  }));
}

async function searchClients(term: string, limit: number): Promise<SearchResultItem[]> {
  const result = await pool.query<{
    id: string;
    name: string;
    company: string | null;
  }>(
    `SELECT
       c.id,
       c.name,
       c.company
     FROM clients c
     WHERE c.deleted_at IS NULL
       AND (
         c.name ILIKE $1
         OR COALESCE(c.company, '') ILIKE $1
         OR COALESCE(c.email, '') ILIKE $1
       )
     ORDER BY c.updated_at DESC
     LIMIT $2`,
    [term, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: "client",
    title: row.name,
    subtitle: row.company,
    projectId: null,
    clientId: row.id,
    matchedOn: "name|company|email"
  }));
}

export async function runSearch(input: {
  query: string;
  scope: SearchScope;
  limit: number;
}): Promise<SearchResult> {
  const term = `%${input.query.trim()}%`;
  const scope = input.scope;

  const [projects, tasks, files, clients] = await Promise.all([
    scope === "all" || scope === "projects" ? searchProjects(term, input.limit) : Promise.resolve([]),
    scope === "all" || scope === "tasks" ? searchTasks(term, input.limit) : Promise.resolve([]),
    scope === "all" || scope === "files" ? searchFiles(term, input.limit) : Promise.resolve([]),
    scope === "all" || scope === "clients" ? searchClients(term, input.limit) : Promise.resolve([])
  ]);

  return { projects, tasks, files, clients };
}

