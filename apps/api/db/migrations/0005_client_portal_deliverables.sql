ALTER TABLE users
ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'staff';

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_account_type_check;

ALTER TABLE users
ADD CONSTRAINT users_account_type_check CHECK (account_type IN ('staff', 'client'));

ALTER TABLE activity_log
ADD COLUMN IF NOT EXISTS client_visible BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE client_memberships (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(30) NOT NULL DEFAULT 'reviewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, user_id),
  CONSTRAINT client_memberships_role_check CHECK (role IN ('reviewer', 'viewer'))
);

CREATE TABLE client_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email CITEXT NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'reviewer',
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_invitations_role_check CHECK (role IN ('reviewer', 'viewer'))
);

CREATE TYPE deliverable_status AS ENUM ('draft', 'in_review', 'changes_requested', 'approved');
CREATE TYPE review_decision AS ENUM ('approved', 'changes_requested');

CREATE TABLE deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status deliverable_status NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE deliverable_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  submission_note TEXT,
  submitted_by UUID NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deliverable_id, version_number)
);

CREATE TABLE deliverable_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_version_id UUID NOT NULL REFERENCES deliverable_versions(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id),
  decision review_decision NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_client_memberships_user ON client_memberships(user_id, client_id);
CREATE INDEX idx_client_invitations_client ON client_invitations(client_id, created_at DESC);
CREATE INDEX idx_client_invitations_email ON client_invitations(email, expires_at DESC);
CREATE INDEX idx_deliverables_project ON deliverables(project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_deliverable_versions_deliverable ON deliverable_versions(deliverable_id, version_number DESC);
CREATE INDEX idx_deliverable_reviews_version ON deliverable_reviews(deliverable_version_id, created_at DESC);
