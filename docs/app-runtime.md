# Application runtime contract

What a container running the shortener must provide, and what it can expect
in return. Written for whoever builds the image and deploys it; you should not
need to read the application code.

The rule behind everything here: **build one image and promote it unchanged
through test → staging → QA → prod. Only environment variables differ.**

---

## 1. At a glance

| Item | Value |
|---|---|
| Runtime | Python 3.12, dependencies locked in `app/uv.lock` |
| Start command | `python -m shortener` |
| Migration command | `alembic -c /path/to/alembic.ini upgrade head` (separate job; never at app startup) |
| Listen address | `0.0.0.0:$PORT` (default `8000`), plain HTTP |
| Processes | One per container; scale with replicas |
| Liveness | `GET /healthz` → 200 |
| Readiness | `GET /readyz` → 200 ready, 503 not ready |
| Build identity | `GET /version` |
| Metrics | `GET /metrics` (Prometheus text format, same port) |
| Logs | JSON, one object per line, stdout only |
| Shutdown | SIGTERM → drain for up to `SHUTDOWN_TIMEOUT_SECONDS` (20 s) → exit 0 |
| Database | PostgreSQL 16 |
| Disk | Writes nothing; a read-only root filesystem is fine |
| Privileges | None; runs as any non-root UID, no privileged port |

---

## 2. Building the image

### What the image needs from `app/`

| Path | Why |
|---|---|
| `pyproject.toml`, `uv.lock`, `.python-version` | Dependency definition and lock |
| `src/` | Application package (only needed at install time if installed non-editable) |
| `alembic.ini`, `migrations/` | Needed at **runtime** by the migration command |

Tests, `.venv/` and caches should not be in the image.

### Installing

A production install, verified to run without the source tree and without
dev dependencies:

```sh
uv sync --frozen --no-dev --no-editable
```

This creates `.venv/` containing the `shortener` package plus the `alembic`
and `uvicorn` executables. Put `.venv/bin` on `PATH` (or call it explicitly).
`--frozen` makes the build fail rather than silently re-resolve if the lock
file is stale.

### Build-time values: `GIT_SHA` and `APP_VERSION`

These identify the build. They are reported by `/version` and the
`app_build_info` metric, and canary automation uses them to confirm which build
is live, so they must be correct:

- Pass them as build arguments and set them as `ENV` in the image, so they
  travel with the image and are identical in every environment.
- **Do not set them at deploy time.** A deploy-time value can disagree with the
  code actually running, which defeats the purpose.
- Neither has a default. The app refuses to start without them (see §4).

| Variable | Format | Typical source |
|---|---|---|
| `GIT_SHA` | 7–40 hex characters (stored lowercase) | `git rev-parse HEAD` or `${{ github.sha }}` |
| `APP_VERSION` | Any non-empty string, ≤ 64 characters | Release tag, e.g. `1.4.0` or `1.4.0-rc.1` |

### Process and signals

- Use the **exec form** for the command, e.g. `["python", "-m", "shortener"]`.
  The shell form wraps the process in `/bin/sh`, which does not forward
  SIGTERM, so the app would be killed instead of shut down gracefully.
- The app runs fine as PID 1, and its exit codes are the same with or without
  an init such as `tini` (§7).
- Optional: `PYTHONDONTWRITEBYTECODE=1` (skip `.pyc` writes) and
  `PYTHONUNBUFFERED=1`. Logs are flushed per line regardless.

---

## 3. Starting the service

```sh
python -m shortener
```

On start the process:

1. Reads and validates every setting (§4). If anything is missing or invalid,
   it writes one JSON log line at level `CRITICAL` listing **every** problem,
   then **exits with code 78** (`EX_CONFIG`). Secret values are never echoed.
2. Configures JSON logging.
3. Listens on `0.0.0.0:$PORT` and logs `"starting"` with environment, version
   and git SHA. If chaos is enabled it also logs a `WARNING`.

It does **not** connect to the database at startup. The pool connects on first
use, so the process starts (and passes liveness) even while the database is
down. Readiness reports the database state (§6).

`/healthz` answered about 0.6 s after launch in local testing; no startup
probe is needed.

---

## 4. Environment variables

All configuration comes from environment variables. Names are
case-insensitive. Unknown variables are ignored. A complete, commented example
is in [`/.env.example`](../.env.example).

### Required (no defaults; startup fails without them)

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://shortener:<password>@db:5432/shortener` | PostgreSQL connection. **Secret.** `postgresql://`, `postgres://` and `postgresql+asyncpg://` are accepted. Inject it from your secret store. TLS to the database has not been tested yet, so verify it before relying on it. |
| `APP_ENV` | `staging` | Which environment this is: one of `local`, `test`, `staging`, `qa`, `prod`. Shown in `/version` and metrics; gates chaos in prod. |
| `APP_VERSION` | `1.4.0` | Build-time. See §2. |
| `GIT_SHA` | `3f9c2e1` | Build-time. See §2. |
| `PUBLIC_BASE_URL` | `https://sho.rt` | Public origin of this environment. Used to build `short_url` in API responses and to refuse links that point back at the shortener. A trailing slash is ignored. |

### Optional

| Variable | Default | Allowed | Purpose |
|---|---|---|---|
| `PORT` | `8000` | 1–65535 | HTTP listen port. |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` | Minimum log level. Probe and scrape requests are logged at `DEBUG`. |
| `DB_POOL_SIZE` | `5` | 1–100 | Persistent database connections per replica. |
| `DB_MAX_OVERFLOW` | `5` | 0–100 | Extra connections allowed during bursts. |
| `READINESS_TIMEOUT_SECONDS` | `2` | 0 < x ≤ 30 | How long `/readyz` waits for the database. |
| `SHUTDOWN_TIMEOUT_SECONDS` | `20` | 1–300 | Maximum time to drain in-flight requests after SIGTERM. |
| `CHAOS_ERROR_RATE` | `0` | 0.0–1.0 | Fraction of `/api/*` requests that fail on purpose. See §8. |
| `CHAOS_ALLOW_IN_PROD` | `false` | `true` / `false` | Required to use chaos when `APP_ENV=prod`. See §8. |

**Database connections:** each replica opens up to
`DB_POOL_SIZE + DB_MAX_OVERFLOW` connections (10 by default) for requests,
plus one short-lived connection per `/readyz` probe (outside the pool, closed
straight after). Size
PostgreSQL's `max_connections` for the maximum replica count across a rollout,
including old and new versions running side by side during a canary.

---

## 5. Database and migrations

### Running migrations

```sh
alembic -c /path/to/app/alembic.ini upgrade head
```

- Needs only `DATABASE_URL`; the other variables are not required.
- Works from any working directory when given `-c`.
- **Idempotent:** if the database is already at the latest version, it does
  nothing and exits 0. Exits non-zero on failure.
- Logs JSON to stdout, like the app.
- **Run it once per deploy, before the new version receives traffic**, as a
  separate one-off job or init step. The app never migrates itself.
- **Concurrent jobs are safe:** each job takes a PostgreSQL advisory lock, so
  a second job waits for the first, then finds nothing to do.
- **Lock timeout of 5 s:** if a migration statement cannot get its table lock
  within 5 s (e.g. a long-running query holds it), the job fails with
  `LockNotAvailableError` instead of queueing live traffic behind it. The
  database is left as it was before that migration; retry the job.

Other useful commands: `alembic … current` (shows the applied version) and
`alembic … upgrade head --sql` (prints SQL without running it).

### Canary safety

Every migration is backward-compatible with the previous release
(expand/contract). The old version keeps working after the migration runs, so:

1. Run migrations.
2. Start the canary with the new version.
3. Roll back by routing traffic away from the canary. **Do not downgrade the
   database** as part of a rollback; the old version already works with the
   newer schema. Downgrades are for development only and can delete data.

### Permissions

The migration job needs to create tables in the target schema. The service
needs `SELECT`, `INSERT`, `UPDATE` and `DELETE` on the tables. One role for
both is fine; separate roles are better in prod.

---

## 6. Health and observability endpoints

All are on the same port as the API and require no authentication.

| Endpoint | Touches DB | 200 means | Non-200 | Use for |
|---|---|---|---|---|
| `GET /healthz` | **Never** | The process is alive and serving HTTP | (no response) | **Liveness.** Restart the container if it fails repeatedly. Because it ignores the database, a database outage does not cause restart loops. |
| `GET /readyz` | `SELECT 1` on a dedicated connection | The database answered within `READINESS_TIMEOUT_SECONDS` | **503** `{"status":"unavailable"}` | **Readiness / load-balancer health.** Stop routing traffic while it fails; do not restart. Set the probe timeout above `READINESS_TIMEOUT_SECONDS` (e.g. 3 s). |
| `GET /version` | No | `{"version","git_sha","environment"}` | | Confirm which build is serving, e.g. after a canary shift. |
| `GET /metrics` | No | Prometheus text format | | Scraping. |

Response bodies: `/healthz` → `{"status":"ok"}`, `/readyz` →
`{"status":"ready"}`.

Suggested probe settings: liveness every 10 s, failing after 3 attempts;
readiness every 5 s, failing after 2.

### Metrics

| Metric | Type | Labels |
|---|---|---|
| `http_requests_total` | counter | `method`, `route`, `status` |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` |
| `app_build_info` | gauge (always 1) | `version`, `git_sha`, `environment` |
| `app_chaos_error_rate` | gauge | (none) |
| `process_*`, `python_*` | standard | |

- `route` is the route **template**, never the raw path: `/api/links`,
  `/api/links/{code}`, `/{code}`, `/healthz`, …. Requests that match no route
  share `route="unmatched"`. Unrecognised HTTP methods share
  `method="OTHER"`. Label cardinality stays bounded no matter how many links
  exist or what clients send.
- `/readyz` uses its own connection, not the request pool, so a replica that
  is merely busy (pool exhausted) still reports ready.
- Metrics are per process. With one process per container, every replica is
  its own scrape target.
- Request metrics carry no build labels; join with `app_build_info` per
  scrape target to compare builds during a canary. For example, the 5xx ratio
  per git SHA:

  ```promql
  sum by (git_sha) (rate(http_requests_total{status=~"5.."}[5m])
    * on(instance) group_left(git_sha) app_build_info)
  /
  sum by (git_sha) (rate(http_requests_total[5m])
    * on(instance) group_left(git_sha) app_build_info)
  ```

### Logs

One JSON object per line on stdout; nothing is written to stderr or files.

```json
{"timestamp": "2026-10-05T20:15:01.123+00:00", "level": "INFO", "logger": "shortener.access",
 "message": "request", "request_id": "4f0c…", "method": "GET", "route": "/{code}",
 "path": "/aB3xK9q", "status": 307, "duration_ms": 3.41}
```

- Every line has `timestamp` (UTC), `level`, `logger`, `message` and
  `request_id` (`null` outside a request).
- One exception: if a request crashes **after** its response has started
  streaming, uvicorn logs the error after the request has finished, so that
  line has `request_id: null`. The app's own error line for the same failure
  carries the ID.
- One access-log line per request (`logger: shortener.access`).
- Errors include a full traceback in `exc_info`, still on one line.

### Request IDs

- If a request carries `X-Request-ID` matching `[A-Za-z0-9._-]{1,128}`, that
  value is used. Otherwise a new random ID is generated. Unsafe incoming values
  are replaced, not echoed.
- The ID appears on every log line for the request and is returned in the
  `X-Request-ID` response header, including on errors.
- To trace a request end to end, have Traefik set or forward `X-Request-ID`.

---

## 7. Shutdown

On **SIGTERM** (or SIGINT) the process:

1. Stops accepting new connections and closes idle keep-alive connections.
2. Lets in-flight requests finish, for at most `SHUTDOWN_TIMEOUT_SECONDS`
   (default 20 s). Requests still running after that are cancelled.
3. Closes database connections and logs `"stopped"`.
4. Exits with code **0**, whether or not it runs as PID 1.

Exit codes: **0** = clean shutdown, **78** = invalid configuration (§3),
**137** = killed (SIGKILL, e.g. the stop timeout expired mid-drain), anything
else = crash.

Requirements for the platform:

- **The orchestrator's stop timeout must exceed `SHUTDOWN_TIMEOUT_SECONDS`**,
  with a margin. Docker's default `docker stop` timeout is only **10 s**, so
  with the default 20 s drain set the stop grace period to at least 25–30 s
  (compose `stop_grace_period`), or lower `SHUTDOWN_TIMEOUT_SECONDS`. Otherwise
  the process is SIGKILLed mid-drain.
- Take the replica out of load balancing **before** sending SIGTERM where the
  platform allows it. Once draining starts, the port stops accepting new
  connections, so requests routed to it fail to connect instead of being
  served.

---

## 8. Chaos errors (`CHAOS_ERROR_RATE`)

Lets you deliberately ship a "bad" build to prove that automated canary
rollback works.

- With `CHAOS_ERROR_RATE=0.3`, about 30% of requests to `/api/*` return
  **HTTP 500** with body `{"detail": "Injected failure (chaos)"}`. The handler
  never runs, so nothing is written.
- **Not affected:** `/{code}` redirects, `/healthz`, `/readyz`, `/version`,
  `/metrics`. Probes keep passing, so the orchestrator keeps the canary running
  and only your error-rate analysis can catch it, which is the point.
- Injected failures are counted in `http_requests_total{status="500"}` under
  their real route (e.g. `route="/api/links"`), and each one logs a `WARNING`
  with `"chaos": true`.
- At startup, an enabled rate logs a `WARNING`, and `app_chaos_error_rate`
  shows the configured value.
- **Prod guard:** when `APP_ENV=prod`, any rate above 0 is refused at startup
  (exit 78) unless `CHAOS_ALLOW_IN_PROD=true` is also set. Treat that override
  as a deliberate, temporary, reviewed change.
- Default is `0` (off). Set it per deployment (on the canary only); never bake
  it into the image.

---

## 9. Exposed paths and known limitations

| Path | Purpose | Expose publicly? |
|---|---|---|
| `GET /{code}`, `HEAD /{code}` | Redirect (HEAD does not count a click) | Yes |
| `/api/links…` | Create, read, delete links | See limitation below |
| `/healthz`, `/readyz` | Probes | Not needed |
| `/version` | Build identity | Harmless; your choice |
| `/metrics` | Prometheus | **No.** Restrict to the monitoring network. |
| `/docs`, `/redoc`, `/openapi.json` | API documentation | Your choice; consider blocking in prod |

- **There is no authentication.** Anyone who can reach `/api/links` can create
  or delete any link. Restrict access at the edge (Traefik middleware, IP
  allow-list or an auth proxy) if that matters for your environment.
- TLS is terminated at the edge; the app speaks plain HTTP.
- No rate limiting in the app.
