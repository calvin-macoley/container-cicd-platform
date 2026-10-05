---
description: Run the full local quality gate for the app
---
From app/, run in order and stop at the first failure:
1. uv run ruff check .
2. uv run ruff format --check .
3. uv run mypy src
4. uv run pytest -m "not integration"   (enforces the coverage gate)
5. If TEST_DATABASE_URL is set: uv run pytest -m integration --no-cov
   (tests never use DATABASE_URL)
Explain the cause of any failure and propose a fix. Do not edit platform files.
