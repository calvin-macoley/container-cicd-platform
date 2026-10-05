from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

from shortener.config import DbSettings, Settings
from shortener.deps import get_repository
from shortener.main import create_app
from tests.fakes import FakeDatabase, FakeLinkRepository

SETTINGS_ENV_VARS = (
    "DATABASE_URL",
    "DB_POOL_SIZE",
    "DB_MAX_OVERFLOW",
    "APP_ENV",
    "APP_VERSION",
    "GIT_SHA",
    "PUBLIC_BASE_URL",
    "PORT",
    "LOG_LEVEL",
    "READINESS_TIMEOUT_SECONDS",
    "SHUTDOWN_TIMEOUT_SECONDS",
    "CHAOS_ERROR_RATE",
    "CHAOS_ALLOW_IN_PROD",
)

VALID_ENV = {
    "DATABASE_URL": "postgresql://user:pw@db.invalid:5432/shortener",
    "APP_ENV": "test",
    "APP_VERSION": "1.2.3",
    "GIT_SHA": "abc1234",
    "PUBLIC_BASE_URL": "https://sho.rt",
}


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Remove every setting from the process environment for the test."""
    for name in SETTINGS_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.fixture
def make_settings(clean_env: pytest.MonkeyPatch) -> Callable[..., Settings]:
    """Build Settings from a valid baseline, overridable per test."""

    def _make(**overrides: Any) -> Settings:
        values: dict[str, Any] = {k.lower(): v for k, v in VALID_ENV.items()}
        values.update(overrides)
        return Settings(**values)

    return _make


@pytest.fixture
def settings(make_settings: Callable[..., Settings]) -> Settings:
    return make_settings()


@pytest.fixture
def repo() -> FakeLinkRepository:
    return FakeLinkRepository()


@pytest.fixture
def app(settings: Settings, repo: FakeLinkRepository) -> FastAPI:
    """App wired to in-memory fakes: unit tests never need a database."""
    application = create_app(settings)
    application.dependency_overrides[get_repository] = lambda: repo
    application.state.db = FakeDatabase()
    return application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# --- Integration database: TEST_DATABASE_URL only ----------------------------
#
# Tests never use DATABASE_URL: it may name a real development database, and
# integration tests truncate and drop tables. pytest_configure removes it from
# the environment for the whole run; its value is kept only to refuse a
# TEST_DATABASE_URL that points at the same database.

_removed_database_url: str | None = None


class IntegrationSettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    test_database_url: str | None = None


def pytest_configure(config: pytest.Config) -> None:
    global _removed_database_url
    _removed_database_url = os.environ.pop("DATABASE_URL", None)


def pytest_unconfigure(config: pytest.Config) -> None:
    if _removed_database_url is not None:
        os.environ["DATABASE_URL"] = _removed_database_url


def _same_database(a: str, b: str) -> bool:
    def key(url: str) -> tuple[str | None, int, str | None]:
        parsed = make_url(url)
        return (parsed.host, parsed.port or 5432, parsed.database)

    try:
        return key(a) == key(b)
    except ArgumentError:
        return a == b


def integration_db_settings() -> DbSettings | None:
    """DbSettings for TEST_DATABASE_URL, or None when it is not set."""
    url = IntegrationSettings().test_database_url
    if not url:
        return None
    if _removed_database_url and _same_database(url, _removed_database_url):
        raise pytest.UsageError(
            "TEST_DATABASE_URL points at the same database as DATABASE_URL. Integration "
            "tests truncate and drop tables; use a separate, disposable database."
        )
    try:
        return DbSettings(database_url=SecretStr(url))
    except ValidationError as exc:
        raise pytest.UsageError(f"TEST_DATABASE_URL is invalid: {exc.errors()[0]['msg']}") from None


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip integration tests cleanly when TEST_DATABASE_URL is not set."""
    if integration_db_settings() is not None:
        return
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL is not set")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)
