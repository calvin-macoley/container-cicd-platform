# Container CI/CD Platform

A URL-shortener REST API used to demonstrate container-based delivery across
multiple environments (test → staging → QA → prod). The same image runs
everywhere; only environment variables differ.

- **Application** (`app/`): Python 3.12, FastAPI, async SQLAlchemy 2.x,
  Alembic, PostgreSQL 16.
- **Platform**: Dockerfiles, compose files, CI workflows, Terraform, Ansible,
  Traefik and monitoring, built against the
  [runtime contract](docs/app-runtime.md).

| Document | What it covers |
|---|---|
| [docs/app-runtime.md](docs/app-runtime.md) | The contract a container must satisfy: commands, env vars, probes, shutdown |
| [docs/architecture.md](docs/architecture.md) | Service structure and the ADR index |
| [docs/AI-WORKFLOW.md](docs/AI-WORKFLOW.md) | How AI assistance is used and constrained in this repo |
| [.env.example](.env.example) | Every environment variable, with placeholder values |

## API

| Method | Path | Success | Errors | Description |
|---|---|---|---|---|
| `POST` | `/api/links` | 201 + `Location` | 409 alias taken, 422 invalid, 503 no free code (retry) | Create a short link |
| `GET` | `/api/links/{code}` | 200 | 404 | Link details and click stats (expired links included, with `is_expired`) |
| `DELETE` | `/api/links/{code}` | 204 | 404 | Delete a link |
| `GET` | `/{code}` | 307 redirect | 404 missing or expired | Follow a short link and count the click |
| `GET` | `/healthz` | 200 | | Liveness; never touches the database |
| `GET` | `/readyz` | 200 | 503 | Readiness; checks the database |
| `GET` | `/version` | 200 | | `{"version", "git_sha", "environment"}` |
| `GET` | `/metrics` | 200 | | Prometheus metrics |

Interactive docs are served at `/docs`.

### Creating a link

```sh
curl -s -X POST http://localhost:8000/api/links \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/some/long/path", "alias": "promo", "expires_at": "2027-01-01T00:00:00Z"}'
```

- `url` (required): `http` or `https`, at most 2048 characters. Must not point
  at the shortener itself. It is stored in normalised form, so the response's
  `target_url` can differ slightly from the input: a bare host gains a trailing
  slash (`https://example.com` → `https://example.com/`) and international
  domain names are converted to punycode.
- `alias` (optional): 3–32 characters from `A-Z a-z 0-9 _ -`. Reserved names
  (`api`, `healthz`, `readyz`, `version`, `metrics`, `docs`, `redoc`) are
  refused. Without an alias, a random 7-character code is generated.
- `expires_at` (optional): an ISO 8601 timestamp **with a timezone**, in the
  future. Expired links stop redirecting (404) but stay visible in
  `GET /api/links/{code}`.

> **No authentication:** anyone who can reach `/api/links` can create or delete
> links. Restrict access at the edge if needed.

## Local development

Requires [uv](https://docs.astral.sh/uv/) and a PostgreSQL 16 database. All
commands run from `app/`.

```sh
cd app
uv sync                                   # install Python 3.12 deps into .venv

# The parentheses run this in a subshell: the exports end with it, so the dev
# database URL never leaks into a later test run (see the warning below).
(
  export DATABASE_URL=postgresql://shortener:<password>@localhost:5432/shortener
  export APP_ENV=local APP_VERSION=0.0.0-dev GIT_SHA=0000000
  export PUBLIC_BASE_URL=http://localhost:8000
  uv run alembic upgrade head             # create or upgrade the schema
  uv run python -m shortener              # serve on 0.0.0.0:8000 (Ctrl-C to stop)
)
```

### Quality checks

```sh
uv run ruff check . && uv run ruff format --check .
uv run mypy src
uv run pytest -m "not integration"        # unit tests, no database, 85% coverage gate

# Integration tests: ONLY against a disposable database.
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<throwaway_db> \
  uv run pytest -m integration --no-cov
```

> **Warning: integration tests destroy data.** They run whenever
> `DATABASE_URL` is set in the environment, including a plain `uv run pytest`.
> They **truncate the `links` table** before every test and **drop it**
> (`alembic downgrade base`) to check that migrations are reversible. Never
> run them with `DATABASE_URL` pointing at a database whose data you want to
> keep. When it is unset they are skipped automatically.
