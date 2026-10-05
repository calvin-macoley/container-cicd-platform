"""Migrations are reversible and match the ORM models (db-migration skill)."""

from __future__ import annotations

import asyncio

import pytest
from alembic import command
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from shortener.config import load_db_settings
from tests.integration.conftest import alembic_config

pytestmark = pytest.mark.integration


def _tables() -> set[str]:
    async def fetch() -> set[str]:
        engine = create_async_engine(load_db_settings().async_database_url, poolclass=NullPool)
        try:
            async with engine.connect() as conn:
                return set(await conn.run_sync(lambda c: inspect(c).get_table_names()))
        finally:
            await engine.dispose()

    return asyncio.run(fetch())


def test_upgrade_downgrade_upgrade(migrated: None) -> None:
    config = alembic_config()

    assert "links" in _tables()
    command.downgrade(config, "base")
    assert "links" not in _tables()
    command.upgrade(config, "head")
    assert "links" in _tables()


def test_models_match_migrations(migrated: None) -> None:
    # Raises if autogenerate would produce any operation.
    command.check(alembic_config())
