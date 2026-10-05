# Architecture

## Overview
A URL-shortener REST API, built as one container image that runs unchanged in
test, staging, QA and prod; only environment variables differ. The contract
the image offers the platform is in [app-runtime.md](app-runtime.md).

```
client ──► Traefik ──► shortener (FastAPI / uvicorn, 1 process per replica) ──► PostgreSQL 16
                                    │
                                    └── /metrics ◄── Prometheus
```

### Inside the service (`app/src/shortener/`)

| Layer | Module | Responsibility |
|---|---|---|
| Entrypoint | `__main__.py` | Load config, configure logging, run uvicorn |
| Config | `config.py` | The only place env vars are read; validated at startup |
| Middleware | `middleware/` | Request ID → metrics + access log → unhandled-error handler |
| Routes | `routes/` | Parse input, call a service, map errors to HTTP status codes |
| Services | `services/links.py` | Business rules (codes, aliases, expiry), no HTTP or SQL |
| Persistence | `repository.py`, `models.py`, `db.py` | SQL behind a `LinkRepository` protocol |
| Migrations | `app/migrations/` | Alembic, run as a separate command |

Unit tests replace the repository and database with in-memory fakes;
integration tests run the same app against a real, disposable PostgreSQL named
by `TEST_DATABASE_URL`. Tests never use `DATABASE_URL`.

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

## Architecture decision records

| ADR | Title | Status |
|---|---|---|
| [001](adr/001-fastapi-async-sqlalchemy.md) | FastAPI and async SQLAlchemy for the shortener API | Proposed |
