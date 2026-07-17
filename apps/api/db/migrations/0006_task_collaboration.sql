CREATE TABLE task_assignees (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);

INSERT INTO task_assignees (task_id, user_id, assigned_by)
SELECT id, assigned_to, created_by
FROM tasks
WHERE assigned_to IS NOT NULL
ON CONFLICT (task_id, user_id) DO NOTHING;

CREATE TABLE task_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT 'slate',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_labels_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT task_labels_color_check CHECK (color IN ('violet', 'blue', 'green', 'amber', 'rose', 'slate'))
);

CREATE UNIQUE INDEX idx_task_labels_project_name
  ON task_labels (project_id, lower(name));

CREATE TABLE task_label_assignments (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, label_id)
);

CREATE INDEX idx_task_assignees_user ON task_assignees(user_id, task_id);
CREATE INDEX idx_task_labels_project ON task_labels(project_id, name);
CREATE INDEX idx_task_label_assignments_label ON task_label_assignments(label_id, task_id);
