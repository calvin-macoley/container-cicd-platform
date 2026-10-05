from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from shortener.config import Settings
from shortener.main import create_app

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
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
