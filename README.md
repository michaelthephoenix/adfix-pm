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
| `npm run account:recover-admin` | Recover an existing administrator using local database access |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed:demo` | Add/update demo records without clearing existing data |
| `npm run openapi:sync` | Export OpenAPI and generate frontend TypeScript contracts |
| `npm run typecheck` / `npm run typecheck:web` | Check backend/frontend types |
| `npm test` | Run API and frontend tests |
| `npm run test:container` | Build and smoke-test the production image when Docker is available |
| `npm run build` | Build API and React application |
| `npm start` | Serve the built React app and API from port 4000 |
| `npm run check` | Run all type checks, tests, and production builds |

## Sign-in and permissions

- Access tokens are short-lived and kept only in browser memory.
- Rotating refresh tokens use secure HTTP-only cookies and never enter frontend JavaScript. Rotation is transactional, and reuse revokes the affected token family.
- Internal staff accounts are created by an administrator. Client accounts are created only through secure invitations; there is no public staff signup.
- Administrator-created staff accounts and recovered accounts start with a temporary password. They can inspect their session and open Settings, but cannot enter the workspace until they choose a permanent password.
- Every password change or administrator reset increments the account security version and revokes all access and refresh sessions. The current password is required for self-service changes.
- Staff and client account types are enforced by API middleware.
- Client responses use dedicated sanitized portal endpoints.
- Invitation tokens are random, single-use, stored only as hashes, revocable, and expire after seven days.
- Files are limited to 50 MB, checked against an allowlist, stored under generated object keys, checksummed with SHA-256, and authorized again on every download.

## Data backup and reset

Stop the app before copying a backup. Back up the entire `apps/api/.data` directory so the database and uploads remain consistent. Restore by replacing that directory while the app is stopped. Use `npm run db:reset:demo` when a clean demonstration state is preferred over restoration.

## Optional PostgreSQL and object storage

Set `DATABASE_URL` in `apps/api/.env` to use any normal PostgreSQL service instead of embedded PGlite. The SQL and application logic are provider-neutral.

Local uploads implement the shared storage-provider interface. A future S3-compatible adapter can replace it without changing project, authorization, deliverable, or review code. Configure `LOCAL_UPLOAD_DIR` for a different local path.

See `apps/api/.env.example` for all runtime settings. Production requires HTTPS, `COOKIE_SECURE=true`, explicit allowed origins, and unique JWT secrets of at least 32 characters.

The first embedded-database production startup also requires a unique `SEED_ADMIN_PASSWORD`. The bootstrap inserts an administrator only when none exists, marks that password as temporary, and never resets an existing password. With hosted PostgreSQL, run `npm run db:migrate` and then `npm run db:seed` once using the same bootstrap settings. Remove the bootstrap password from the environment after the first administrator has been created.

### Password recovery

People can change their own password in Settings. Administrators can issue a one-time temporary password for an active staff or client account from Settings → Account recovery. The temporary value is returned once, is never written to the audit log, revokes the person's existing sessions, and must be replaced at the next sign-in.

If every administrator is locked out, stop the application and use direct local access to recover an existing administrator. Set `RECOVERY_ADMIN_EMAIL` and `RECOVERY_ADMIN_PASSWORD` in the current terminal, run `npm run account:recover-admin`, and then remove both variables from the terminal. Do not put the recovery password on the command line or in a committed `.env` file. The command runs pending migrations, reactivates that administrator, revokes all sessions, records an audit event without the password, and forces another password change after sign-in. It will not create a new administrator or promote a non-administrator.

## Single-service and container mode

After `npm run build`, `npm start` serves the React build and REST API together at `http://localhost:4000`. The included provider-neutral `Dockerfile` uses `/app/data` for the embedded database and uploads:

```text
docker build -t adfix-pm .
docker run --rm -p 4000:4000 -v adfix-data:/app/data \
  -e APP_ORIGIN=https://pm.example.com \
  -e CORS_ALLOWED_ORIGINS=https://pm.example.com \
  -e COOKIE_SECURE=true \
  -e JWT_ACCESS_SECRET=<unique-32-plus-character-secret> \
  -e JWT_REFRESH_SECRET=<different-32-plus-character-secret> \
  -e SEED_ADMIN_PASSWORD=<unique-first-login-password> \
  adfix-pm
```

Terminate TLS at the host or reverse proxy before exposing the container. After the first successful startup, restart it without `SEED_ADMIN_PASSWORD`; the existing administrator is retained unchanged.

The runtime image contains production dependencies only, runs as a non-root user, and includes a health check that verifies both the database and writable file storage. `npm run test:container` performs an image build, starts an isolated container on a temporary local port, waits for `/api/ready`, and cleans up afterward. It exits successfully with a clear skip message when Docker is not installed or running.

Any Node.js container host, VPS, or local Docker installation can run the same image. Hosting is intentionally optional for the prototype.

## API reference

While the API is running:

- OpenAPI JSON: `http://localhost:4000/api/v1/docs.json`
- API documentation page: `http://localhost:4000/api/v1/docs`
- Readiness check: `http://localhost:4000/api/v1/ready`

The versioned API lives at `/api/v1`; `/api` remains a backward-compatible alias.
