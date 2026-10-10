---
description: Run the full local quality gate for the app
---
From app/, run in order and stop at the first failure:
1. npm run lint            (ESLint + Prettier check, server and web)
2. npm run typecheck       (tsc --noEmit, server and web)
3. npm run test            (unit tests for server and web)
4. If TEST_DATABASE_URL is set, step 3 also runs the server's integration
   tests against it (tests never use DATABASE_URL); otherwise they skip.
5. npm run build           (catches bundling errors the typecheck misses)
Explain the cause of any failure and propose a fix. Do not edit platform files.
