# Container CI/CD Platform
URL shortener (API + web UI) used to demonstrate container-based multi-environment delivery.

## Commands
Until the Makefile exists, run from app/:
- npm ci
- npm run verify          (lint + format check + typecheck + unit tests)
- npm run build           (server/dist and web/dist)

## Conventions
- Node 22, TypeScript (strict), Express 5, Zod, Kysely + pg, pino, prom-client, Vitest
- Web UI: React 19 + Vite, served by the server from the same image
- All config via env vars (validated in server/src/config.ts). No secrets in code or compose files.
- Every endpoint needs a test. Every schema change needs a Kysely migration.
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
