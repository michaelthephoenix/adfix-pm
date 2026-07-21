-- Keep client-review withdrawals auditable without erasing the original
-- submission actor or timestamp. This is intentionally separate from 0010:
-- early prototype databases may already have applied that migration.

ALTER TABLE deliverable_versions
ADD COLUMN IF NOT EXISTS client_withdrawn_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS client_withdrawn_at TIMESTAMPTZ;
