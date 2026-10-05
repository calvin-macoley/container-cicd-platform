"""Fixtures for tests against a real PostgreSQL at DATABASE_URL.

The database is migrated to head once per session and the links table is
truncated before each test, so point DATABASE_URL at a disposable database.
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

from shortener.config import Settings, load_db_settings
from shortener.db import build_engine
from shortener.main import create_app

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def alembic_config() -> Config:
    config = Config(str(ALEMBIC_INI))
    config.attributes["configure_logging"] = False
    return config


@pytest.fixture(scope="session")
def database_url() -> str:
    return load_db_settings().database_url.get_secret_value()


@pytest.fixture(scope="session")
def migrated(database_url: str) -> None:
    command.upgrade(alembic_config(), "head")


@pytest.fixture(scope="session")
async def engine(migrated: None) -> AsyncIterator[AsyncEngine]:
    eng = build_engine(load_db_settings())
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
