# App conventions
- Source in src/shortener/, tests mirror that layout under tests/.
- Routes stay thin; logic lives in service functions that are unit-testable.
- All settings come from config.py (pydantic-settings). Never call os.environ elsewhere.
- Use route templates (not raw paths) as metric labels to avoid cardinality blowups.

## Commands (run from app/)
- uv run ruff check . && uv run ruff format --check .
- uv run mypy src
- uv run pytest
