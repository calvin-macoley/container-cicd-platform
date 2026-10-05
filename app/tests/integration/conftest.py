"""Fixtures for tests against a real PostgreSQL at TEST_DATABASE_URL.

The database is migrated to head once per session, the links table is
truncated before each test, and the migration tests drop it. Point
TEST_DATABASE_URL at a disposable database. DATABASE_URL is never used.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from shortener.config import DbSettings, Settings
from shortener.db import build_engine
from shortener.main import create_app
from tests.conftest import integration_db_settings

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def alembic_config(db_settings: DbSettings) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.attributes["configure_logging"] = False
    # Passed explicitly so migrations/env.py never falls back to DATABASE_URL.
    config.attributes["database_url"] = db_settings.async_database_url
    return config


@pytest.fixture(scope="session")
def db_settings() -> DbSettings:
    settings = integration_db_settings()
    assert settings is not None, "integration tests are skipped without TEST_DATABASE_URL"
    return settings


@pytest.fixture(scope="session")
def database_url(db_settings: DbSettings) -> str:
    return db_settings.database_url.get_secret_value()


@pytest.fixture(scope="session")
def migrated(db_settings: DbSettings) -> None:
    command.upgrade(alembic_config(db_settings), "head")


@pytest.fixture(scope="session")
async def engine(db_settings: DbSettings, migrated: None) -> AsyncIterator[AsyncEngine]:
    eng = build_engine(db_settings)
    yield eng
    await eng.dispose()


@pytest.fixture(autouse=True)
async def _clean_tables(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE links RESTART IDENTITY"))


@pytest.fixture
def settings(make_settings: Callable[..., Settings], database_url: str) -> Settings:
    return make_settings(database_url=database_url)


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    """The real app: real repository, real database, no fakes."""
    application = create_app(settings)
    yield application
    await application.state.db.dispose()
