"""Database engine and sessions.

Creating the engine does not connect; connections are opened on first use,
so the app starts (and /healthz answers) even when the database is down.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from shortener.config import DbSettings

logger = logging.getLogger(__name__)


def build_engine(settings: DbSettings) -> AsyncEngine:
    return create_async_engine(
        settings.async_database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
    )


def build_probe_engine(settings: DbSettings) -> AsyncEngine:
    """Engine for readiness checks: a fresh connection per probe, outside the pool.

    If probes borrowed from the request pool, a replica whose pool is merely
    busy would report not-ready and be pulled from load balancing, shifting its
    traffic onto the others. A dedicated connection measures only whether the
    database is reachable.
    """
    return create_async_engine(settings.async_database_url, poolclass=NullPool)


class Database:
    def __init__(self, engine: AsyncEngine, probe_engine: AsyncEngine) -> None:
        self.engine = engine
        self.probe_engine = probe_engine
        self.sessions = async_sessionmaker(engine, expire_on_commit=False)

    @classmethod
    def from_settings(cls, settings: DbSettings) -> Database:
        return cls(build_engine(settings), build_probe_engine(settings))

    async def ping(self, within_seconds: float) -> bool:
        """True if a trivial query succeeds within ``within_seconds``."""
        try:
            async with asyncio.timeout(within_seconds), self.probe_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except Exception as exc:
            logger.warning("database ping failed", extra={"error": type(exc).__name__})
            return False
        return True

    async def dispose(self) -> None:
        await self.engine.dispose()
        await self.probe_engine.dispose()

    def session(self) -> AsyncSession:
        return self.sessions()
