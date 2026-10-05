"""Offline migrations (``alembic upgrade head --sql``) need no database."""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def test_upgrade_sql_renders_without_database(capsys: pytest.CaptureFixture[str]) -> None:
    config = Config(str(ALEMBIC_INI))
    config.attributes["configure_logging"] = False
    # Never contacted in offline mode; passed explicitly, not via DATABASE_URL.
    config.attributes["database_url"] = "postgresql+asyncpg://u:p@db.invalid:5432/x"

    command.upgrade(config, "head", sql=True)

    sql = capsys.readouterr().out
    assert "CREATE TABLE links" in sql
    assert "CONSTRAINT uq_links_code UNIQUE (code)" in sql
    assert "INSERT INTO alembic_version" in sql
