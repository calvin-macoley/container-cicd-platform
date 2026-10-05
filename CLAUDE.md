# Container CI/CD Platform
URL-shortener API used to demonstrate container-based multi-environment delivery.

## Commands
# - make lint / make typecheck / make test / make up / make down
Until the Makefile exists, run from app/:
   - uv run ruff check . && uv run ruff format --check .
   - uv run mypy src
   - uv run pytest
## Conventions
- Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, pytest
- All config via env vars (pydantic-settings). No secrets in code or compose files.
- Every endpoint needs a test. Every schema change needs an Alembic migration.
- The same image runs in every environment; only env vars differ.

## Boundaries
- Never run terraform apply, ansible against prod, or docker push.
- Never read or edit .env files or vault files.

## Ownership
The human writes all DevOps code: Dockerfiles, compose files, Makefile,
GitHub Actions workflows, Terraform, Ansible, Traefik, and monitoring config.
- Do not create or modify these files unless the current message explicitly asks.
- Do not "helpfully" add them while working on app code. If the app needs a
  DevOps change, describe what's needed and stop.
- Reviewing, explaining, and suggesting improvements is always welcome.
