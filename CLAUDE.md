# Container CI/CD Platform
URL-shortener API used to demonstrate container-based multi-environment delivery.

## Commands
- make lint / make typecheck / make test / make up / make down

## Conventions
- Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, pytest
- All config via env vars (pydantic-settings). No secrets in code or compose files.
- Every endpoint needs a test. Every schema change needs an Alembic migration.
- The same image runs in every environment; only env vars differ.

## Boundaries
- Never run terraform apply, ansible against prod, or docker push.
- Never read or edit .env files or vault files.
