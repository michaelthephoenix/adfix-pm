# Adfix Project Management System - Design Document

## Executive Summary

A web-based project management system for Adfix's creative workflow, tracking projects from client acquisition through delivery with integrated tasking, file management, collaboration, and reporting.

---

## 1. System Overview

### 1.1 Target Users
- Small creative team (5-10 people)
- Initial permission model: mostly equal access with one elevated action (project delete)
- Roles: Account Managers, Creative Directors, Designers, Video Editors, Project Coordinators

### 1.2 Core Objectives
- Visual project pipeline tracking
- Detailed task management with deadlines
- Hybrid file storage (direct upload + cloud links)
- Reporting and analytics
- Mobile-responsive web access

### 1.3 Non-Functional Requirements
- Availability target: 99.5% monthly uptime (MVP), 99.9% target after stabilization
- Performance target: P95 API response < 500ms for core read endpoints at 200 concurrent users
- Scalability target: 10k active projects and 1M task records without major redesign
- Backup and restore:
  - Automated database backups every 6 hours
  - Point-in-time recovery enabled
  - RPO <= 6 hours, RTO <= 4 hours
- Observability:
  - Centralized logs with 30-day retention
  - Error tracking and alerting for auth, upload, and phase transition failures

---

## 2. Technical Architecture

### 2.1 Technology Stack Recommendation

**Frontend:**
- React 18+ with TypeScript
- Tailwind CSS for styling
- shadcn/ui for component library
- React Query for data fetching and caching
- React Router for navigation
- Recharts for analytics/reporting
- Zod for request/response validation at boundaries

**Backend:**
- Node.js with Express
- PostgreSQL database
- JWT access tokens + refresh token rotation
- AWS S3 (or equivalent) for object storage
- RESTful API architecture
- Redis for rate limiting and short-lived caching (recommended)

**Deployment:**
- Vercel/Netlify (frontend)
- Railway/Render/Fly.io (backend)
- Managed PostgreSQL (Neon/Supabase/RDS)
- Cloudflare CDN + WAF

### 2.2 Database Schema (Hardened Baseline)

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Enums
CREATE TYPE project_phase AS ENUM (
  'client_acquisition',
  'strategy_planning',
  'production',
  'post_production',
  'delivery'
);

CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'blocked');
CREATE TYPE priority_level AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE file_type AS ENUM ('client_profile', 'proposal', 'creative_brief', 'nda', 'contract', 'asset', 'deliverable', 'other');
CREATE TYPE storage_type AS ENUM ('local', 's3', 'google_drive', 'dropbox', 'onedrive');

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Auth sessions (refresh token rotation support)
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL,
  user_agent TEXT,
  ip_address INET,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clients
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  email CITEXT,
  phone VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  current_phase project_phase NOT NULL DEFAULT 'client_acquisition',
  priority priority_level NOT NULL DEFAULT 'medium',
  budget NUMERIC(12,2),
  start_date DATE NOT NULL,
  deadline DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT projects_valid_dates CHECK (deadline >= start_date)
);

-- Tasks
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  phase project_phase NOT NULL,
  status task_status NOT NULL DEFAULT 'pending',
  priority priority_level NOT NULL DEFAULT 'medium',
  assigned_to UUID REFERENCES users(id),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Files
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_type file_type NOT NULL,
  storage_type storage_type NOT NULL,
  object_key TEXT NOT NULL,
  external_url TEXT,
  mime_type VARCHAR(127) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  checksum_sha256 CHAR(64),
  uploaded_by UUID NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Project team (many-to-many)
CREATE TABLE project_team (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

-- Activity log (append-only)
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Required indexes
CREATE INDEX idx_projects_phase ON projects(current_phase) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_deadline ON projects(deadline) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_assignee_due ON tasks(assigned_to, due_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_project_created ON files(project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_activity_project_created ON activity_log(project_id, created_at DESC);
```

### 2.3 Data and Migration Rules
- Use soft delete (`deleted_at`) for core entities to preserve auditability.
- Enforce all phase and status values with DB enums (not free text).
- All API read queries exclude soft-deleted records by default.
- Use forward-only migrations with rollback scripts validated in staging.

---

## 3. Feature Specifications

### 3.1 Visual Project Pipeline (Kanban Board)

**Layout:**
- 5 columns representing project phases
- Drag-and-drop between phases
- Color-coded priority indicators
- Quick view cards showing project name, client, deadline, team avatars, and task completion %

**Functionality:**
- Filter by client, team member, deadline, and priority
- Search projects by name and client
- Click card to open project detail view
- Create new project from board context

### 3.2 Detailed Task Management

**Task Board View:**
- Filter by project, assignee, status, phase, and overdue
- Create, edit, delete (soft delete) tasks
- Assign to team members
- Due dates with calendar picker
- Status updates (`pending -> in_progress -> completed` or `blocked`)
- Task dependencies (v2)

**Task Details:**
- Title, description, phase, status, priority
- Assigned team member and due date
- Comments/notes
- Related files
- Status history (from activity log)

### 3.3 File Management

**Repository Structure (logical):**
```text
Project Name/
|- Client Documents/
|  |- Client Profile
|  |- NDA
|  `- Contract
|- Planning/
|  |- Proposal
|  |- Creative Brief
|  `- Strategy Document
|- Production/
|  |- Assets
|  `- Drafts
`- Deliverables/
   `- Final Files
```

**Features:**
- Direct upload (default limit: 50MB; configurable by environment)
- External link support (Google Drive/Dropbox/OneDrive)
- File preview for images and PDFs
- Signed URL download with expiration
- File type categorization and search
- Versioning baseline (`version` column); full history UI in v2

### 3.4 Reporting and Analytics

**Dashboard Metrics:**
- Projects by phase
- Task completion rate by team member
- Average project duration by phase
- Overdue tasks count
- Projects completed in month/quarter

**Metric Definitions (must be fixed in code):**
- Completion rate = completed tasks / total non-deleted tasks
- Overdue task = due_date < current_date AND status != completed
- Project duration = delivery_date - start_date
- Time in phase = timestamp(current_phase_entered) - timestamp(previous_phase_entered)

### 3.5 Workflow and State Transition Rules

- Project phase transitions are linear only:
  - `client_acquisition -> strategy_planning -> production -> post_production -> delivery`
- Backward moves require admin override endpoint and mandatory reason in `activity_log`.
- Task status transitions:
  - Allowed: `pending -> in_progress`, `in_progress -> completed`, `in_progress -> blocked`, `blocked -> in_progress`
  - Disallowed direct jump: `pending -> completed`
- When project phase advances:
  - Prompt to close open tasks in prior phase
  - Auto-create default task template for next phase (idempotent)

---

## 4. User Interface Design

### 4.1 Navigation Structure

Main navigation:
- Dashboard
- Projects
- Tasks
- Files
- Reports
- Team
- Settings

### 4.2 Page Layouts

**Dashboard:**
- KPI cards
- Recent activity feed
- Upcoming deadlines
- Quick actions

**Project Detail View:**
- Header: project name, client, phase, deadline
- Tabs: overview, tasks, files, team, activity
- Sidebar: quick stats, members, nearest deadline

**Kanban Board:**
- 5-column layout
- Filters/search in header
- Card counts per column
- Drag-and-drop with optimistic UI and server reconciliation

---

## 5. Workflow Examples

### 5.1 New Project Creation Flow

1. User clicks "New Project".
2. Form fields: client, name, description, start_date, deadline, initial phase, team assignment.
3. On submit, project card appears on board.
4. System creates default tasks for the initial phase.
5. Activity log entry: project created.

### 5.2 Moving Project Through Phases

1. User drags project card from Strategy Planning to Production.
2. API validates legal transition.
3. UI prompts to resolve incomplete Strategy Planning tasks.
4. System creates Production template tasks (if missing).
5. Activity log records phase change and actor.
6. Notification is sent to assigned team members.

### 5.3 File Upload and Organization

1. User opens Project Detail -> Files.
2. User chooses "Upload File" or "Link External File".
3. User selects file category.
4. For uploads, backend issues pre-signed URL; client uploads directly to storage.
5. Backend validates metadata and writes `files` record.
6. Activity log records upload/link action.

---

## 6. Security and Access Control

### 6.1 Authentication and Session Model

- Email/password login with bcrypt/argon2 password hashing
- Access token (JWT): 15-minute expiry
- Refresh token: 30-day expiry, rotation on each refresh
- Refresh tokens stored hashed in `auth_sessions`
- Logout revokes current session; "logout all" revokes all active sessions
- Password policy: minimum 12 chars, mixed classes recommended
- Optional MFA in Phase 2

### 6.2 API and Platform Security

- HTTPS only, HSTS enabled
- CORS allowlist (no wildcard in production)
- Rate limiting:
  - Auth endpoints: 10 requests per minute per IP
  - General API: 120 requests per minute per user token
- Input validation for all endpoints (schema-based)
- Security headers via middleware (`helmet` or equivalent)
- Audit log on auth events, phase transitions, deletes, and file operations

### 6.3 File Security

- Allowlist MIME types; reject executable/script uploads
- AV scanning for uploaded files before marking as "available"
- Signed URL downloads with short TTL (5-15 minutes)
- Per-object authorization check before URL issuance
- Optional server-side encryption (SSE-S3/SSE-KMS)

### 6.4 Data Protection and Compliance

- Daily full backup + 6-hour incremental backup
- Encrypted database at rest (managed service default)
- PII minimization in logs
- Data retention policy:
  - Activity log: 18 months
  - Auth logs: 12 months

### 6.5 User Permissions (MVP)

- All users can view projects/tasks/files and create/edit tasks.
- All users can upload/link files and add comments.
- Project delete requires project creator confirmation and second confirmation modal.
- Hard delete restricted to system admin tooling only (not in standard UI).

---

## 7. Implementation Phases

### Phase 0 (Foundation - 1 week)
- CI/CD setup
- Migration pipeline and staging environment
- Logging, error tracking, health checks

### Phase 1 (MVP - 4-6 weeks)
- Auth and session model (access + refresh)
- Project CRUD and kanban
- Basic task management with state rules
- Direct file upload to object storage
- Dashboard baseline metrics

### Phase 2 (Enhanced Features - 3-4 weeks)
- Cloud link integrations
- Advanced analytics and report exports
- Activity notifications (email/in-app)
- Search refinements and file previews

### Phase 3 (Optimization - 2-3 weeks)
- Performance tuning and caching
- Mobile UX refinements
- Bulk operations
- Permission model expansion

---

## 8. API Endpoints (RESTful)

```text
Authentication:
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
POST   /api/auth/logout-all
GET    /api/auth/me

Users:
GET    /api/users
GET    /api/users/:id
PUT    /api/users/:id

Clients:
GET    /api/clients
POST   /api/clients
GET    /api/clients/:id
PUT    /api/clients/:id
DELETE /api/clients/:id

Projects:
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PUT    /api/projects/:id
PATCH  /api/projects/:id/phase
DELETE /api/projects/:id

Tasks:
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
PUT    /api/tasks/:id
PATCH  /api/tasks/:id/status
DELETE /api/tasks/:id

Files:
GET    /api/files/project/:projectId
POST   /api/files/upload-url
POST   /api/files/complete-upload
POST   /api/files/link
GET    /api/files/:id/download-url
DELETE /api/files/:id

Activity:
GET    /api/projects/:id/activity

Analytics:
GET    /api/analytics/dashboard
GET    /api/analytics/projects
GET    /api/analytics/team
GET    /api/analytics/timeline
```

---

## 9. Testing and Release Requirements

- Unit tests: business logic, validators, auth utilities
- Integration tests: API + DB + storage contract paths
- End-to-end tests: login, create project, phase move, upload file
- Migration tests on staging before each production deploy
- Definition of done for release:
  - No critical vulnerabilities
  - P95 API latency within target
  - Error rate < 1% on core endpoints

---

## 10. Success Metrics

- Project creation time: < 2 minutes
- Task completion tracking accuracy: 100%
- File retrieval URL issuance: < 500ms P95
- User adoption rate: 80% within 2 weeks
- Mobile usability score: 90+
- Uptime: >= 99.5% monthly

---

## 11. Future Enhancements (Post-Launch)

- Client portal (read-only external access)
- Time tracking integration
- Budget vs actual cost tracking
- Automated task templates by project type
- Figma/Adobe integrations
- Calendar sync (Google/Outlook)
- Slack/Teams notifications
- AI-based project duration estimates
- Recurring project templates
- Department-level access controls

---

## Appendix A: Sample Data Structure

```json
{
  "project": {
    "id": "proj_123",
    "name": "Nike Summer Campaign 2026",
    "client": {
      "id": "client_456",
      "name": "Nike Marketing Team",
      "company": "Nike Inc."
    },
    "currentPhase": "production",
    "priority": "high",
    "deadline": "2026-06-15",
    "team": [
      {
        "userId": "user_789",
        "name": "Sarah Johnson",
        "role": "Creative Director"
      }
    ],
    "tasks": [
      {
        "id": "task_001",
        "title": "Create storyboard",
        "status": "completed",
        "assignedTo": "user_789",
        "dueDate": "2026-05-20"
      }
    ],
    "files": [
      {
        "id": "file_001",
        "name": "Creative_Brief_v2.pdf",
        "type": "creative_brief",
        "storageType": "s3",
        "objectKey": "projects/proj_123/planning/Creative_Brief_v2.pdf"
      }
    ]
  }
}
```

---

**Document Version:** 1.1  
**Last Updated:** February 11, 2026  
**Author:** Adfix System Design Team
