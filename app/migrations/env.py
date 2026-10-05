"""Alembic environment: async engine, URL from DATABASE_URL via shortener.config."""

from __future__ import annotations

import asyncio

from alembic import context
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from shortener.config import load_db_settings
from shortener.logging import configure_logging
from shortener.models import Base

target_metadata = Base.metadata

# Serialises concurrent migration jobs (arbitrary constant, unique to this app).
MIGRATION_ADVISORY_LOCK_KEY = 0x5_4052_7E4E
# A DDL statement that cannot get its table lock within this time fails instead
# of queueing all live traffic on that table behind it. Retry the job later.
MIGRATION_LOCK_TIMEOUT = "5s"


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
            # Session-level lock: a second migration job waits here until the
            # first finishes (released when this connection closes). Taken
            # before lock_timeout is set, so waiting for it is not cut short.
            await connection.execute(
                text("SELECT pg_advisory_lock(:key)"), {"key": MIGRATION_ADVISORY_LOCK_KEY}
            )
            await connection.execute(text(f"SET lock_timeout = '{MIGRATION_LOCK_TIMEOUT}'"))
            await connection.commit()

            await connection.run_sync(_run_sync)
            await connection.commit()
    finally:
        await engine.dispose()


# Tests run migrations in-process and keep pytest's log capture.
if context.config.attributes.get("configure_logging", True):
    configure_logging("INFO")

if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
