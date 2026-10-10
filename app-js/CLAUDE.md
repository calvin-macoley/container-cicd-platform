# App conventions

- npm workspaces: server/ (Express API) and web/ (React UI). Tests mirror
  source: server/tests/unit, server/tests/integration, web/src/*.test.tsx.
- Routes stay thin; logic lives in service functions (server/src/services/)
  that are unit-testable with the in-memory fakes in server/tests/fakes.ts.
- All settings come from server/src/config.ts. Never read process.env
  elsewhere (ESLint enforces it in server/src).
- Use route templates (not raw paths) as metric labels to avoid cardinality
  blowups. Mount routers at the root with full paths, so the reserved-codes
  test sees every top-level route.
- Keep the wire contract (paths, status codes, snake_case JSON, error bodies,
  metric and log field names) stable; docs/app-runtime.md documents it.
- Imports in server/ use the .js extension (NodeNext ESM).
- The UI calls the API with relative paths only; no per-environment URLs.

## Commands (run from app/)

- npm run verify (lint, format check, typecheck, unit tests)
- npm run test -w server (integration tests run when TEST_DATABASE_URL is set)
- npm run dev -w server / -w web (Vite proxies API paths to :8000)
