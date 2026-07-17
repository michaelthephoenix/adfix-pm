# Adfix PM functional prototype

Adfix PM is a local-first creative project operations application. Staff organize clients, projects, team assignments, tasks, files, and deliverables across five phases. Invited clients use a separate portal to review submitted work without seeing internal tasks, budgets, staff notes, team controls, or audit history.

The five phases are Client Acquisition, Strategy & Planning, Production, Post-production, and Delivery. Client approval never controls a phase transition. Delivery is a staff decision; it permanently closes client approval and change-request actions while preserving final files and review history.

## Start locally

Requirements: Node.js 22+ and npm. PostgreSQL, Railway, Docker, and cloud storage are not required.

```text
npm install
npm run db:reset:demo
npm run dev
```

Open `http://localhost:5173`. The API runs at `http://localhost:4000`.

The embedded PostgreSQL-compatible database is created automatically under `apps/api/.data/pglite`. Uploaded files are stored under `apps/api/.data/uploads`. Both paths are ignored by Git.

## Demo accounts

| Workspace | Email | Password |
| --- | --- | --- |
| Administrator/staff | `admin@adfix.local` | `ChangeMe123!` |
| Manager and other seeded staff | `manager@adfix.local` | `DemoUser123!` |
| Invited client portal | `client@adfix.local` | `DemoUser123!` |

The demo reset creates a representative project, tasks, a client membership, a local deliverable file, and an open client review.

## Prototype journey

1. Sign in as staff and open Projects.
2. Create a client/project or use Demo Project.
3. Move work forward one phase at a time on the five-column board.
4. Open a client and create a secure seven-day invitation link.
5. Open a project, upload files, create a deliverable, and submit a numbered version.
6. Sign in as the client, open My Projects, and approve or request changes. A change request requires a comment.
7. Return as staff and move the project into Delivery. If reviews remain unresolved, the UI warns and asks for confirmation but does not block staff.
8. Return as the client. Files and history remain downloadable, but review controls are read-only.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start API and React app together |
| `npm run db:reset:demo` | Clear local business data and rebuild the demo journey |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed:demo` | Add/update demo records without clearing existing data |
| `npm run openapi:sync` | Export OpenAPI and generate frontend TypeScript contracts |
| `npm run typecheck` / `npm run typecheck:web` | Check backend/frontend types |
| `npm test` | Run API and frontend tests |
| `npm run build` | Build API and React application |
| `npm start` | Serve the built React app and API from port 4000 |
| `npm run check` | Run all type checks, tests, and production builds |

## Sign-in and permissions

- Access tokens are short-lived and kept only in browser memory.
- Rotating refresh tokens use HTTP-only cookies. The app restores a session on load and retries one failed authenticated request after refresh.
- Staff and client account types are enforced by API middleware.
- Client responses use dedicated sanitized portal endpoints.
- Invitation tokens are random, single-use, stored only as hashes, revocable, and expire after seven days.
- Files are limited to 50 MB, checked against an allowlist, stored under generated object keys, checksummed with SHA-256, and authorized again on every download.

## Data backup and reset

Stop the app before copying a backup. Back up the entire `apps/api/.data` directory so the database and uploads remain consistent. Restore by replacing that directory while the app is stopped. Use `npm run db:reset:demo` when a clean demonstration state is preferred over restoration.

## Optional PostgreSQL and object storage

Set `DATABASE_URL` in `apps/api/.env` to use any normal PostgreSQL service instead of embedded PGlite. The SQL and application logic are provider-neutral.

Local uploads implement the shared storage-provider interface. A future S3-compatible adapter can replace it without changing project, authorization, deliverable, or review code. Configure `LOCAL_UPLOAD_DIR` for a different local path.

See `apps/api/.env.example` for all runtime settings. Set `COOKIE_SECURE=true` only when serving over HTTPS. Production secrets must be at least 32 characters and must not use the development defaults.

## Single-service and container mode

After `npm run build`, `npm start` serves the React build and REST API together at `http://localhost:4000`. The included provider-neutral `Dockerfile` uses `/app/data` for the embedded database and uploads:

```text
docker build -t adfix-pm .
docker run --rm -p 4000:4000 -v adfix-data:/app/data \
  -e JWT_ACCESS_SECRET=replace-with-32-plus-random-characters \
  -e JWT_REFRESH_SECRET=replace-with-another-32-plus-random-value \
  adfix-pm
```

Any Node.js container host, VPS, or local Docker installation can run the same image. Hosting is intentionally optional for the prototype.

## API reference

While the API is running:

- OpenAPI JSON: `http://localhost:4000/api/v1/docs.json`
- API documentation page: `http://localhost:4000/api/v1/docs`
- Readiness check: `http://localhost:4000/api/v1/ready`

The versioned API lives at `/api/v1`; `/api` remains a backward-compatible alias.
