"""Alembic environment: async engine, URL from DATABASE_URL via shortener.config."""

from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from shortener.config import load_db_settings
from shortener.logging import configure_logging
from shortener.models import Base

target_metadata = Base.metadata


def _configure(connection: Connection | None = None, url: str | None = None) -> None:
    context.configure(
        connection=connection,
        url=url,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        transaction_per_migration=True,
    )


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of executing it (``alembic upgrade head --sql``)."""
    _configure(url=load_db_settings().async_database_url)
    with context.begin_transaction():
        context.run_migrations()


def _run_sync(connection: Connection) -> None:
    _configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(load_db_settings().async_database_url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run_sync)
            await connection.commit()
    finally:
        await engine.dispose()


if context.config.attributes.get("configure_logging", True):
    configure_logging("INFO")

if context.is_offline_mode():
    run_migrations_offline()
else:
    connection = context.config.attributes.get("connection")
    if connection is None:
        asyncio.run(run_migrations_online())
    else:
        # Called programmatically with an existing connection (integration tests).
        _run_sync(connection)
