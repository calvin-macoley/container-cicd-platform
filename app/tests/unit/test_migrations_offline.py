"""Offline migrations (``alembic upgrade head --sql``) need no database."""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def test_upgrade_sql_renders_without_database(
    clean_env: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Never contacted in offline mode.
    clean_env.setenv("DATABASE_URL", "postgresql://u:p@db.invalid:5432/x")
    config = Config(str(ALEMBIC_INI))
    config.attributes["configure_logging"] = False

    command.upgrade(config, "head", sql=True)

    sql = capsys.readouterr().out
    assert "CREATE TABLE links" in sql
    assert "CONSTRAINT uq_links_code UNIQUE (code)" in sql
    assert "INSERT INTO alembic_version" in sql
