-- Allow deliverables to point to any secure web-based review or storage platform.
ALTER TYPE storage_type ADD VALUE IF NOT EXISTS 'external';
