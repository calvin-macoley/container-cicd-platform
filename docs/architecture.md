# Architecture

## Overview
A URL shortener (REST API and web UI), built as one container image that runs unchanged in
test, staging, QA and prod; only environment variables differ. The contract
the image offers the platform is in [app-runtime.md](app-runtime.md).

```
browser / client ──► Traefik ──► shortener (Node 22 / Express, 1 process per replica) ──► PostgreSQL 16
                                          │  serves API + built React UI
                                          └── /metrics ◄── Prometheus
```

### Inside the service (`app/server/src/`)

| Layer | Module | Responsibility |
|---|---|---|
| Entrypoint | `main.ts` | Load config, configure logging, listen, drain on SIGTERM |
| Config | `config.ts` | The only place env vars are read; validated with Zod at startup |
| Middleware | `middleware/`, `http.ts` | Request ID → metrics + access log → routes → error handler |
| Routes | `routes/` | Parse input, call a service, map errors to HTTP status codes |
| Services | `services/links.ts` | Business rules (codes, aliases, expiry), no HTTP or SQL |
| Persistence | `repository.ts`, `db.ts` | SQL (Kysely) behind a `LinkRepository` interface |
| Migrations | `migrate.ts`, `migrations/` | Kysely migrator, run as a separate command |
| Web UI | `app/web/src/` | React app, built by Vite into `app/web/dist`, served at `/` and `/assets/*` |

Unit tests replace the repository and database with in-memory fakes;
integration tests run the same app against a real, disposable PostgreSQL named
by `TEST_DATABASE_URL`. Tests never use `DATABASE_URL`. UI tests run in jsdom
against a mocked `fetch`.

### Key behaviours
- **Redirects** are one atomic `UPDATE … RETURNING` statement that checks expiry
  against the database clock and increments the click counter.
- **Two clocks decide expiry.** Redirects use the database's `now()`, so every
  replica agrees. The API's `is_expired` field and the create-time "must be in
  the future" check use the app's clock. With clock skew between app and
  database, `is_expired` can briefly read `false` while the redirect already
  returns 404. The redirect is authoritative; keep hosts NTP-synced.
- **Readiness** uses its own non-pooled connection, so a busy replica (request
  pool exhausted) is not reported unready and pulled from load balancing.
- **Alias uniqueness** is enforced by a unique constraint, so concurrent creates
  cannot both succeed.
- **Schema changes** follow expand/contract so the old and new versions can run
  against the same database during a canary.
- **Chaos errors** (`CHAOS_ERROR_RATE`) fail a fraction of `/api/*` requests
  after routing, so the failures appear under their real route in metrics and
  can trigger automated canary rollback.
- **The UI shares the API's origin.** It calls relative paths, so the same
  bundle works in every environment with no per-environment configuration.
  `/` revalidates on every load; hashed bundles under `/assets/*` are cached
  for a year, so a release reaches browsers on their next page load.

## Architecture decision records

| ADR | Title | Status |
|---|---|---|
| [001](adr/001-fastapi-async-sqlalchemy.md) | FastAPI and async SQLAlchemy for the shortener API | Superseded by 002 |
| [002](adr/002-typescript-express-react.md) | TypeScript, Express and React for the shortener | Accepted |
