"""Tests must never use DATABASE_URL; integration tests use TEST_DATABASE_URL only."""

from __future__ import annotations

import os

import pytest

from tests import conftest


def test_database_url_is_removed_for_the_whole_run() -> None:
    assert "DATABASE_URL" not in os.environ


def test_unset_test_database_url_disables_integration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TEST_DATABASE_URL", raising=False)
    assert conftest.integration_db_settings() is None


def test_test_database_url_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_DATABASE_URL", "postgresql://u:p@testdb:5432/scratch")
    settings = conftest.integration_db_settings()
    assert settings is not None
    assert settings.async_database_url == "postgresql+asyncpg://u:p@testdb:5432/scratch"


@pytest.mark.parametrize(
    "test_url",
    [
        "postgresql://other:pw@dev-db:5432/app",  # same host, port and database
        "postgresql+asyncpg://u:p@dev-db/app",  # default port, different driver
    ],
)
def test_refuses_the_same_database_as_database_url(
    monkeypatch: pytest.MonkeyPatch, test_url: str
) -> None:
    monkeypatch.setattr(conftest, "_removed_database_url", "postgresql://u:p@dev-db:5432/app")
    monkeypatch.setenv("TEST_DATABASE_URL", test_url)

    with pytest.raises(pytest.UsageError, match="same database as DATABASE_URL"):
        conftest.integration_db_settings()


def test_allows_a_different_database_on_the_same_server(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(conftest, "_removed_database_url", "postgresql://u:p@dev-db:5432/app")
    monkeypatch.setenv("TEST_DATABASE_URL", "postgresql://u:p@dev-db:5432/app_test")
    assert conftest.integration_db_settings() is not None


def test_rejects_non_postgres_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_DATABASE_URL", "mysql://u:p@h/db")
    with pytest.raises(pytest.UsageError, match="TEST_DATABASE_URL is invalid"):
        conftest.integration_db_settings()
