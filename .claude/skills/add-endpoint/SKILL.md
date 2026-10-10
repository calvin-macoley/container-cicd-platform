---
name: add-endpoint
description: Use when adding or changing an API endpoint in app/. Covers route, schema, service logic, tests, and docs.
---
# Adding an endpoint

All paths are under app/server/.

1. Define the request schema (Zod) and response shape in src/schemas.ts.
   Keep the wire format snake_case.
2. Put business logic in a service function under src/services/, not in the
   route. Routes only parse input (`parseBody`), call the service, and map
   service errors to `HttpError` status codes.
3. Add the route in the matching file under src/routes/. Use the full path
   (routers are mounted at the root) and end each `router.route(...)` with
   `.all(methodNotAllowed(...))`. Put `injectChaos` first on /api routes.
4. A new top-level path segment must be added to `RESERVED_CODES` in
   src/services/links.ts; the reserved-codes test fails until it is.
5. If the data model changes, follow the db-migration skill.
6. Write tests from test_template.ts in this folder: at least one success
   case, one validation error, one not-found/conflict case.
7. Confirm the route appears in /metrics under its route template
   (e.g. `/api/links/{code}`), not the raw path.
8. Update the endpoint table in README.md, and the UI in app/web/src/api.ts
   if the UI should use it.
9. Run /verify before reporting done.
