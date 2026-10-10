# 002. TypeScript, Express and React for the shortener

- Status: Accepted
- Date: 2026-10-10
- Supersedes: [001](001-fastapi-async-sqlalchemy.md)

## Context
The shortener was a Python API (ADR 001). We want a web UI alongside it, and
a single language across UI and server so one toolchain, one test runner and
one set of conventions cover the whole app. Everything the platform relies on
must stay the same, so Dockerfiles, compose files, CI, Ansible, dashboards
and canary analysis keep working: routes, status codes, JSON shapes, env
vars, the `links` schema, metric names and labels, log fields, probes, exit
codes and shutdown behaviour ([app-runtime.md](../app-runtime.md)).

## Decision
Rewrite the app in TypeScript on Node 22: Express 5 for HTTP, Zod for config
and request validation, Kysely and node-postgres for SQL, Kysely's migrator
for migrations, pino for JSON logs, prom-client for metrics, and a React 19
UI built by Vite. Express serves the built UI from the same image and port.

## Alternatives considered
- **Keep FastAPI and add a React UI.** Pros: no rewrite risk; the API is
  already tested and documented. Cons: two languages, two toolchains and two
  test runners in one image and one CI job; UI and API types are maintained
  separately and drift.
- **Fastify instead of Express.** Pros: faster; schema-based validation and
  serialization built in; first-class TypeScript. Cons: less familiar;
  plugin encapsulation is another concept to learn. At this traffic,
  Express 5 (native async error handling) is fast enough and better known.
- **Next.js (React UI and API routes in one framework).** Pros: one
  framework; server-side rendering. Cons: its routing and runtime conventions
  fight the exact API contract (catch-all `/{code}`, HEAD semantics, 405s);
  more framework than a two-view UI needs.
- **node-pg-migrate or Prisma instead of Kysely.** Prisma hides the SQL the
  redirect path relies on (one `UPDATE … RETURNING`) and adds a generated
  client. node-pg-migrate is a second tool; Kysely already provides typed
  queries and a migrator with an advisory lock.

## Consequences
- Easier: one language and one `npm run verify` for UI and server; UI and API
  are released together from one image. Express's middleware model maps
  directly onto request IDs, metrics and chaos.
- Harder: Node has no runtime type checks, so every input boundary (env,
  request bodies) must go through Zod. Timestamps have millisecond precision
  (Python had microseconds).
- Dropped: the auto-generated OpenAPI docs (`/docs`, `/redoc`,
  `/openapi.json`). Those paths stay reserved as link aliases.
- Migration path: the first Kysely migration adopts a database already at
  Alembic revision 0001 without changing it, so either implementation can
  serve the same database during a canary or rollback. From now on, schema
  changes are Kysely migrations only.
- Revisit if: the API needs published OpenAPI (add zod-to-openapi), or
  request throughput outgrows Express (Fastify is a contained swap).
