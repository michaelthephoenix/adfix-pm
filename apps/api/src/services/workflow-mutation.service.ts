import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

type MutationKeyRow = {
  id: string;
  request_hash: string;
  response: unknown | null;
};

export type WorkflowMutationClaim<T> =
  | { status: "acquired"; recordId: string }
  | { status: "replay"; response: T }
  | { status: "conflict" }
  | { status: "in_progress" };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function workflowMutationHash(payload: unknown) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export async function claimWorkflowMutation<T>(
  client: PoolClient,
  input: {
    actorId: string;
    operation: string;
    idempotencyKey?: string | null;
    payload: unknown;
  }
): Promise<WorkflowMutationClaim<T> | null> {
  if (!input.idempotencyKey) return null;
  const requestHash = workflowMutationHash(input.payload);
  const inserted = await client.query<MutationKeyRow>(
    `INSERT INTO workflow_mutation_keys (
       actor_id, operation, idempotency_key, request_hash, created_at
     )
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING
     RETURNING id, request_hash, response`,
    [input.actorId, input.operation, input.idempotencyKey, requestHash]
  );
  if (inserted.rows[0]) return { status: "acquired", recordId: inserted.rows[0].id };

  const existing = await client.query<MutationKeyRow>(
    `SELECT id, request_hash, response
     FROM workflow_mutation_keys
     WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3
     FOR UPDATE`,
    [input.actorId, input.operation, input.idempotencyKey]
  );
  const row = existing.rows[0];
  if (!row) return { status: "in_progress" };
  if (row.request_hash !== requestHash) return { status: "conflict" };
  if (row.response !== null) return { status: "replay", response: row.response as T };
  return { status: "in_progress" };
}

export async function completeWorkflowMutation(
  client: PoolClient,
  recordId: string | undefined,
  response: unknown
) {
  if (!recordId) return;
  await client.query(
    `UPDATE workflow_mutation_keys
     SET response = $2::jsonb, completed_at = NOW()
     WHERE id = $1`,
    [recordId, JSON.stringify(response)]
  );
}
