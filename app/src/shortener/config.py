"""Application configuration.

Every setting comes from environment variables and is validated once at
startup. This is the only module that reads the environment.

Two classes exist so that the migration command only needs the database URL:

* ``DbSettings``: used by Alembic (``alembic upgrade head``).
* ``Settings``: everything the HTTP service needs.
"""

from __future__ import annotations

from enum import StrEnum
from functools import cached_property
from typing import Annotated, Self

from pydantic import (
    AnyHttpUrl,
    Field,
    SecretStr,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

_ASYNC_DRIVER = "postgresql+asyncpg://"
_ACCEPTED_SCHEMES = ("postgresql://", "postgres://", _ASYNC_DRIVER)


class Environment(StrEnum):
    LOCAL = "local"
    TEST = "test"
    STAGING = "staging"
    QA = "qa"
    PROD = "prod"


class LogLevel(StrEnum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


class ConfigError(RuntimeError):
    """Raised when the environment does not describe a valid configuration."""


class DbSettings(BaseSettings):
    """Settings needed to reach the database (shared by the app and Alembic)."""

    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore", frozen=True)

    database_url: SecretStr

    db_pool_size: Annotated[int, Field(ge=1, le=100)] = 5
    db_max_overflow: Annotated[int, Field(ge=0, le=100)] = 5

    @field_validator("database_url")
    @classmethod
    def _check_scheme(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        if not raw.startswith(_ACCEPTED_SCHEMES):
            raise ValueError("must be a PostgreSQL URL (postgresql:// or postgresql+asyncpg://)")
        return value

    @cached_property
    def async_database_url(self) -> str:
        """DATABASE_URL rewritten to use the asyncpg driver."""
        raw = self.database_url.get_secret_value()
        for prefix in _ACCEPTED_SCHEMES:
            if raw.startswith(prefix):
                return _ASYNC_DRIVER + raw.removeprefix(prefix)
        raise AssertionError("unreachable: scheme validated")  # pragma: no cover


GitSha = Annotated[str, StringConstraints(pattern=r"^[0-9a-fA-F]{7,40}$", to_lower=True)]
NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class Settings(DbSettings):
    """Full service configuration."""

    app_env: Environment
    app_version: NonEmpty
    git_sha: GitSha
    public_base_url: AnyHttpUrl

    port: Annotated[int, Field(ge=1, le=65535)] = 8000
    log_level: LogLevel = LogLevel.INFO
    readiness_timeout_seconds: Annotated[float, Field(gt=0, le=30)] = 2.0
    shutdown_timeout_seconds: Annotated[int, Field(ge=1, le=300)] = 20

    chaos_error_rate: Annotated[float, Field(ge=0.0, le=1.0)] = 0.0
    chaos_allow_in_prod: bool = False

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_log_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _refuse_chaos_in_prod(self) -> Self:
        if (
            self.app_env is Environment.PROD
            and self.chaos_error_rate > 0
            and not self.chaos_allow_in_prod
        ):
            raise ValueError(
                "CHAOS_ERROR_RATE > 0 is refused when APP_ENV=prod; "
                "set CHAOS_ALLOW_IN_PROD=true to override deliberately"
            )
        return self

    @property
    def public_base(self) -> str:
        """PUBLIC_BASE_URL without a trailing slash."""
        return str(self.public_base_url).rstrip("/")


def _format_errors(exc: ValidationError) -> str:
    lines = []
    for err in exc.errors():
        field = ".".join(str(part) for part in err["loc"]) or "settings"
        name = field.upper() if err["loc"] else field
        if err["type"] == "missing":
            lines.append(f"  {name}: required environment variable is not set")
        else:
            lines.append(f"  {name}: {err['msg']}")
    return "Invalid configuration:\n" + "\n".join(lines)


def load_settings() -> Settings:
    """Read and validate Settings from the environment, failing with a readable error."""
    try:
        return Settings()  # values come from the environment
    except ValidationError as exc:
        raise ConfigError(_format_errors(exc)) from None


def load_db_settings() -> DbSettings:
    """Read and validate DbSettings from the environment."""
    try:
        return DbSettings()
    except ValidationError as exc:
        raise ConfigError(_format_errors(exc)) from None
