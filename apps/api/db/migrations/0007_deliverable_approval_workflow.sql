ALTER TYPE deliverable_status ADD VALUE IF NOT EXISTS 'internal_review';
ALTER TYPE deliverable_status ADD VALUE IF NOT EXISTS 'internal_changes_requested';
ALTER TYPE deliverable_status ADD VALUE IF NOT EXISTS 'internal_approved';

ALTER TABLE deliverable_versions
ADD COLUMN IF NOT EXISTS client_submitted_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS client_submitted_at TIMESTAMPTZ;

UPDATE deliverable_versions dv
SET client_submitted_by = dv.submitted_by,
    client_submitted_at = dv.submitted_at
FROM deliverables d
WHERE d.id = dv.deliverable_id
  AND d.status <> 'draft'
  AND dv.client_submitted_at IS NULL;

CREATE TABLE deliverable_tasks (
  deliverable_id UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deliverable_id, task_id)
);

CREATE TABLE deliverable_internal_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_version_id UUID NOT NULL REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id),
  decision review_decision NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deliverable_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_version_id UUID NOT NULL REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  client_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deliverable_feedback_forwards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_version_id UUID NOT NULL REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  source_review_id UUID REFERENCES deliverable_reviews(id) ON DELETE SET NULL,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  forwarded_by UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deliverable_tasks_task ON deliverable_tasks(task_id, deliverable_id);
CREATE INDEX idx_internal_reviews_version ON deliverable_internal_reviews(deliverable_version_id, created_at DESC);
CREATE INDEX idx_deliverable_messages_version ON deliverable_messages(deliverable_version_id, created_at ASC);
CREATE INDEX idx_feedback_forwards_version ON deliverable_feedback_forwards(deliverable_version_id, created_at DESC);
