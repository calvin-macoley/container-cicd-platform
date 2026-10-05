---
name: add-endpoint
description: Use when adding or changing an API endpoint in app/. Covers route, schema, service logic, tests, and docs.
---
# Adding an endpoint

1. Define request/response models in src/shortener/schemas.py.
2. Put business logic in a service function, not in the route. Routes only
   parse input, call the service, and map errors to HTTP status codes.
3. Add the route in the matching file under src/shortener/routes/.
4. If the data model changes, follow the db-migration skill.
5. Write tests using test_template.py in this folder as a starting point:
   at least one success case, one validation error, one not-found/conflict case.
6. Confirm the route appears in /metrics using its route template, not raw path.
7. Update the endpoint table in README.md.
8. Run /verify before reporting done.
