# Adfix PM

Monorepo scaffold for the Adfix Project Management System.

## Structure
- `apps/api`: Node + Express API (TypeScript)
- `apps/web`: Frontend placeholder
- `packages/config`: shared config placeholder

## Quick Start
1. Copy `apps/api/.env.example` to `apps/api/.env`.
2. Start PostgreSQL: `docker compose up -d`.
3. Install dependencies: `npm install`.
4. Apply schema migrations: `npm run db:migrate`.
5. Seed default admin user: `npm run db:seed`.
6. Run API in dev mode: `npm run dev:api`.

## Auth Test User
- Email: value from `SEED_ADMIN_EMAIL` (default `admin@adfix.local`)
- Password: value from `SEED_ADMIN_PASSWORD` (default `ChangeMe123!`)

## Useful Commands
- `npm run db:migrate`: apply pending SQL migrations from `apps/api/db/migrations`
- `npm run db:seed`: upsert the default admin user
- `npm run db:seed:demo`: seed admin + demo client/project/tasks
- `npm run typecheck`: run TypeScript checks for API + scripts
- `npm run test:api`: run integration tests (auth, clients, projects, phase transitions, activity logs)
- `npm run test:api:coverage`: run integration tests with coverage thresholds

## Rate Limiting
- Auth routes (`/api/auth/*`): `AUTH_RATE_LIMIT_MAX` per `AUTH_RATE_LIMIT_WINDOW_MS`
- Protected API routes: `API_RATE_LIMIT_MAX` per `API_RATE_LIMIT_WINDOW_MS`
- In `NODE_ENV=test`, rate limiting is skipped so tests remain deterministic.

## API Docs + Observability
- API base paths:
  - Preferred (versioned): `/api/v1`
  - Backward-compatible alias: `/api`
- OpenAPI spec endpoints:
  - `GET /api/v1/docs.json`
  - `GET /api/docs.json`
- Docs landing pages:
  - `GET /api/v1/docs`
  - `GET /api/docs`
- Spec now includes all active route groups (`auth`, `clients`, `projects`, `tasks`, `files`, `analytics`, `search`, `users`, admin controls).
- Liveness endpoints:
  - `/api/health`
  - `/api/v1/health`
- Readiness endpoints (database probe):
  - `/api/ready`
  - `/api/v1/ready`
- Every response includes `x-request-id` for tracing.

## Runtime Behavior
- API server handles graceful shutdown on `SIGINT`/`SIGTERM`:
  - stops accepting new HTTP connections
  - closes PostgreSQL pool

## Validation Error Shape
- Request validation failures return:
  - `code`: `VALIDATION_ERROR`
  - `error`: concise message
  - `requestId`: response correlation id
  - `details`: Zod `flatten()` output (`formErrors`, `fieldErrors`)

## Error Contract
- API errors now use a consistent shape:
  - `code`: stable machine-readable identifier (e.g. `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`)
  - `error`: human-readable message
  - `requestId`: correlation id from `x-request-id`

## Seed Profiles
- `SEED_PROFILE=admin_only` (default): only admin user
- `SEED_PROFILE=demo`: admin user + demo client/project/task data

## RBAC
- Project roles:
  - `owner`: project creator (implicit)
  - `manager`, `member`, `viewer`: assigned through project team endpoint
- Team assignment endpoint accepts only: `manager`, `member`, `viewer`.
- Permission model (project-scoped):
  - `viewer`: read-only access
  - `member`: read + tasks/files write
  - `manager`: member permissions + project update + team management
  - `owner`: full permissions including project delete
- `search` and `analytics` responses are scoped to projects the requester can access.
- RBAC denials are audit-logged as `authz_denied` in `activity_log`.

## Admin Controls
- Users table now includes `is_admin` (migration: `0002_admin_controls.sql`).
- Seeded admin user is marked as `is_admin = true`.
- Admin-only user endpoints:
  - `GET /api/users/audit-logs`
  - `PATCH /api/users/:id/status`
  - `POST /api/users/:id/project-roles/reset`

## Current Phase
- Phase 0 foundation scaffolding
- Initial schema migration in `apps/api/db/migrations/0001_init.sql`
- Auth/session endpoints scaffolded under `apps/api/src/routes/auth.ts`
