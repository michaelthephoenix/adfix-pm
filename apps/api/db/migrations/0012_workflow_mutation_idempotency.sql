CREATE TABLE IF NOT EXISTS workflow_mutation_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation VARCHAR(120) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT workflow_mutation_keys_unique UNIQUE (actor_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_mutation_keys_created_at
  ON workflow_mutation_keys(created_at);
