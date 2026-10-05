from __future__ import annotations

from collections.abc import Callable

import pytest
from pydantic import ValidationError

from shortener.config import (
    ConfigError,
    Environment,
    LogLevel,
    Settings,
    load_db_settings,
    load_settings,
)
from tests.conftest import VALID_ENV


def _set_env(mp: pytest.MonkeyPatch, **values: str) -> None:
    for name, value in values.items():
        mp.setenv(name, value)


def test_load_settings_from_env(clean_env: pytest.MonkeyPatch) -> None:
    _set_env(clean_env, **VALID_ENV, PORT="9000", LOG_LEVEL="debug")

    settings = load_settings()

    assert settings.app_env is Environment.TEST
    assert settings.app_version == "1.2.3"
    assert settings.git_sha == "abc1234"
    assert settings.port == 9000
    assert settings.log_level is LogLevel.DEBUG
    assert settings.chaos_error_rate == 0.0
    assert settings.public_base == "https://sho.rt"


def test_defaults(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings()
    assert settings.port == 8000
    assert settings.log_level is LogLevel.INFO
    assert settings.shutdown_timeout_seconds == 20
    assert settings.readiness_timeout_seconds == 2.0
    assert settings.chaos_allow_in_prod is False


@pytest.mark.parametrize(
    "missing", ["DATABASE_URL", "APP_ENV", "APP_VERSION", "GIT_SHA", "PUBLIC_BASE_URL"]
)
def test_missing_required_variable_fails_with_clear_error(
    clean_env: pytest.MonkeyPatch, missing: str
) -> None:
    _set_env(clean_env, **{k: v for k, v in VALID_ENV.items() if k != missing})

    with pytest.raises(ConfigError, match=rf"{missing}: required environment variable is not set"):
        load_settings()


def test_error_message_does_not_leak_database_url(clean_env: pytest.MonkeyPatch) -> None:
    _set_env(clean_env, **{**VALID_ENV, "DATABASE_URL": "mysql://u:hunter2@h/db"})

    with pytest.raises(ConfigError) as exc_info:
        load_settings()

    assert "DATABASE_URL" in str(exc_info.value)
    assert "hunter2" not in str(exc_info.value)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@h:5432/d",
        "postgres://u:p@h:5432/d",
        "postgresql+asyncpg://u:p@h:5432/d",
    ],
)
def test_database_url_normalised_to_asyncpg(
    make_settings: Callable[..., Settings], url: str
) -> None:
    assert make_settings(database_url=url).async_database_url == "postgresql+asyncpg://u:p@h:5432/d"


def test_database_url_is_secret(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings()
    assert "pw" not in repr(settings)
    assert "pw" not in str(settings.model_dump())


@pytest.mark.parametrize("sha", ["xyz1234", "abc12", "a" * 41, ""])
def test_invalid_git_sha_rejected(make_settings: Callable[..., Settings], sha: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(git_sha=sha)


def test_git_sha_lowercased(make_settings: Callable[..., Settings]) -> None:
    assert make_settings(git_sha="ABCDEF0").git_sha == "abcdef0"


def test_unknown_environment_rejected(make_settings: Callable[..., Settings]) -> None:
    with pytest.raises(ValidationError):
        make_settings(app_env="production")


def test_blank_version_rejected(make_settings: Callable[..., Settings]) -> None:
    with pytest.raises(ValidationError):
        make_settings(app_version="  ")


@pytest.mark.parametrize("rate", [-0.1, 1.1])
def test_chaos_rate_bounds(make_settings: Callable[..., Settings], rate: float) -> None:
    with pytest.raises(ValidationError):
        make_settings(chaos_error_rate=rate)


def test_chaos_refused_in_prod(make_settings: Callable[..., Settings]) -> None:
    with pytest.raises(ValidationError, match="CHAOS_ALLOW_IN_PROD"):
        make_settings(app_env="prod", chaos_error_rate=0.2)


def test_chaos_allowed_in_prod_with_override(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings(app_env="prod", chaos_error_rate=0.2, chaos_allow_in_prod=True)
    assert settings.chaos_error_rate == 0.2


def test_zero_chaos_in_prod_is_fine(make_settings: Callable[..., Settings]) -> None:
    assert make_settings(app_env="prod").chaos_error_rate == 0.0


def test_chaos_allowed_outside_prod(make_settings: Callable[..., Settings]) -> None:
    assert make_settings(app_env="staging", chaos_error_rate=0.5).chaos_error_rate == 0.5


def test_chaos_refusal_via_environment(clean_env: pytest.MonkeyPatch) -> None:
    _set_env(clean_env, **{**VALID_ENV, "APP_ENV": "prod", "CHAOS_ERROR_RATE": "0.1"})
    with pytest.raises(ConfigError, match="refused when APP_ENV=prod"):
        load_settings()


def test_load_db_settings_only_needs_database_url(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("DATABASE_URL", "postgresql://u:p@h/d")
    assert load_db_settings().async_database_url == "postgresql+asyncpg://u:p@h/d"


def test_load_db_settings_missing(clean_env: pytest.MonkeyPatch) -> None:
    with pytest.raises(ConfigError, match="DATABASE_URL"):
        load_db_settings()
