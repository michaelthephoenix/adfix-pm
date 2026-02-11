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

## Current Phase
- Phase 0 foundation scaffolding
- Initial schema migration in `apps/api/db/migrations/0001_init.sql`
- Auth/session endpoints scaffolded under `apps/api/src/routes/auth.ts`
