# 001. FastAPI and async SQLAlchemy for the shortener API

- Status: Proposed
- Date: 2026-10-05

## Context
The shortener is a small JSON API whose hot path, `GET /{code}`, is one
database round trip: increment a counter and redirect. It exists to
demonstrate container delivery, so the service must be easy to run as one
image across environments: config from env vars, liveness and readiness
probes, Prometheus metrics, JSON logs, graceful SIGTERM handling, and
migrations that are safe while a canary runs old and new versions together.
The team writes Python, and mypy strict is enforced.

## Decision
Use FastAPI on uvicorn with SQLAlchemy 2.x in async mode (asyncpg driver),
Alembic for migrations, and pydantic-settings for configuration.

## Alternatives considered
- **Flask + sync SQLAlchemy (gunicorn workers).** Pros: the most familiar
  stack; simplest mental model; mature ecosystem. Cons: concurrency comes from
  processes or threads, so each replica needs several workers and Prometheus
  multiprocess mode, which complicates `/metrics`. No built-in request
  validation or OpenAPI, so we'd add marshmallow/pydantic ourselves. Less
  precise typing under mypy strict.
- **FastAPI + sync SQLAlchemy (threadpool).** Pros: keeps FastAPI's validation
  and docs; sync ORM code is easier to debug and has no greenlet layer. Cons:
  every database call occupies a threadpool slot (40 by default), which caps
  concurrency per process; mixing sync handlers with async middleware is easy
  to get subtly wrong.
- **Go (net/http + pgx).** Pros: a single static binary, tiny image, very low
  memory, no runtime dependencies. Cons: a different language from the rest of
  the team's tooling; validation, OpenAPI and migrations are assembled from
  several libraries; slower to iterate on for a demo service.

## Consequences
- Easier: one process per container handles many concurrent requests, so we
  scale by replicas and `/metrics` stays a plain per-process registry.
  Pydantic validates both requests and settings (startup fails fast on bad
  config). OpenAPI comes for free. Types flow end to end under mypy strict.
- Harder: everything on the request path must be non-blocking; one sync call
  stalls the whole process. Async SQLAlchemy runs through greenlets, which
  surprises tools (coverage needed `concurrency = ["greenlet", "thread"]`).
  Async test fixtures need care with event-loop scope.
- Revisit if: the redirect path needs latency or memory well beyond what one
  Python process per replica provides (consider Go), or contributors find the
  async model a barrier (consider FastAPI with sync SQLAlchemy).
