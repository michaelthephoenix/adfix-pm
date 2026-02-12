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
- `npm run typecheck`: run TypeScript checks for API + scripts
- `npm run test:api`: run integration tests (auth, clients, projects, phase transitions, activity logs)
- `npm run test:api:coverage`: run integration tests with coverage thresholds

## Rate Limiting
- Auth routes (`/api/auth/*`): `AUTH_RATE_LIMIT_MAX` per `AUTH_RATE_LIMIT_WINDOW_MS`
- Protected API routes: `API_RATE_LIMIT_MAX` per `API_RATE_LIMIT_WINDOW_MS`
- In `NODE_ENV=test`, rate limiting is skipped so tests remain deterministic.

## Current Phase
- Phase 0 foundation scaffolding
- Initial schema migration in `apps/api/db/migrations/0001_init.sql`
- Auth/session endpoints scaffolded under `apps/api/src/routes/auth.ts`
