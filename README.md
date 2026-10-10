# Container CI/CD Platform

A URL shortener (REST API and web UI) used to demonstrate container-based
delivery across multiple environments (test → staging → QA → prod). The same
image runs everywhere; only environment variables differ.

- **Application** (`app/`): TypeScript on Node 22. `app/server`: Express 5,
  Zod, Kysely + node-postgres, pino, prom-client. `app/web`: React 19 + Vite,
  served by the server. PostgreSQL 16. See [ADR 002](docs/adr/002-typescript-express-react.md).
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
| `HEAD` | `/{code}` | 307 redirect | 404 missing or expired | Same response as `GET` (no body), **without** counting a click; for link checkers and unfurlers |
| `GET` | `/healthz` | 200 | | Liveness; never touches the database |
| `GET` | `/readyz` | 200 | 503 | Readiness; checks the database |
| `GET` | `/version` | 200 | | `{"version", "git_sha", "environment"}` |
| `GET` | `/metrics` | 200 | | Prometheus metrics |
| `GET` | `/` and `/assets/*` | 200 | | Web UI (when built) |

Errors are JSON: `{"detail": "<message>"}`, or for request validation
`{"detail": [{"type", "loc", "msg"}, …]}` with status 422. Other methods on a
known path return 405 with an `Allow` header.

## Web UI

Open `/` in a browser to shorten a URL (optional alias and expiry), copy the
short link, look up a link's clicks by code or short URL, and delete it. The
footer shows the serving build's version, git SHA and environment.

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
  (`api`, `assets`, `healthz`, `readyz`, `version`, `metrics`, `docs`,
  `redoc`, `openapi.json`) are refused. Without an alias, a random 7-character code is generated.
- `expires_at` (optional): an ISO 8601 timestamp **with a timezone**, in the
  future. Expired links stop redirecting (404) but stay visible in
  `GET /api/links/{code}`.

> **No authentication:** anyone who can reach `/api/links` can create or delete
> links. Restrict access at the edge if needed.

## Local development

Requires Node 22 and a PostgreSQL 16 database. All commands run from `app/`.

```sh
cd app
npm ci                                    # install server and web dependencies

export DATABASE_URL=postgresql://shortener:<password>@localhost:5432/shortener
export APP_ENV=local APP_VERSION=0.0.0-dev GIT_SHA=0000000
export PUBLIC_BASE_URL=http://localhost:8000

npm run build                             # server/dist and web/dist
node server/dist/migrate.js               # create or upgrade the schema
node server/dist/main.js                  # API + UI on 0.0.0.0:8000 (Ctrl-C to stop)
```

For live reload, run `npm run dev -w server` and `npm run dev -w web` in two
terminals, then open the Vite URL; it proxies API paths to port 8000.

### Quality checks

```sh
npm run verify                            # lint, format, typecheck, unit tests (server + web)

# Integration tests run against TEST_DATABASE_URL, a disposable database.
export TEST_DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<throwaway_db>
npm run test -w server
```

> **Integration tests destroy data, so they only use `TEST_DATABASE_URL`.**
> They **truncate the `links` table** before every test and **drop it** to
> check that migrations are reversible.
>
> - Tests **never use `DATABASE_URL`**; it is read only to refuse a
>   `TEST_DATABASE_URL` that names the same database (same host, port and
>   database name), so exporting it for the dev server (above) is safe.
> - When `TEST_DATABASE_URL` is unset, integration tests are skipped.
