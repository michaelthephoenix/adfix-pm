-- Preserve every client submission and withdrawal cycle while the version's
-- current visibility columns continue to drive authorization.

CREATE TABLE IF NOT EXISTS deliverable_client_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_version_id UUID NOT NULL REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  event_type VARCHAR(20) NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT deliverable_client_events_type_check
    CHECK (event_type IN ('submitted', 'withdrawn'))
);

CREATE INDEX IF NOT EXISTS idx_deliverable_client_events_version
  ON deliverable_client_events(deliverable_version_id, created_at DESC);

INSERT INTO deliverable_client_events (deliverable_version_id, event_type, actor_id, created_at)
SELECT id, 'submitted', client_submitted_by, client_submitted_at
FROM deliverable_versions
WHERE client_submitted_by IS NOT NULL AND client_submitted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deliverable_client_events event
    WHERE event.deliverable_version_id = deliverable_versions.id
      AND event.event_type = 'submitted'
      AND event.created_at = deliverable_versions.client_submitted_at
  );

INSERT INTO deliverable_client_events (deliverable_version_id, event_type, actor_id, created_at)
SELECT id, 'withdrawn', client_withdrawn_by, client_withdrawn_at
FROM deliverable_versions
WHERE client_withdrawn_by IS NOT NULL AND client_withdrawn_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deliverable_client_events event
    WHERE event.deliverable_version_id = deliverable_versions.id
      AND event.event_type = 'withdrawn'
      AND event.created_at = deliverable_versions.client_withdrawn_at
  );
