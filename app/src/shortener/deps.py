"""FastAPI dependencies."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated, cast

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from shortener.config import Settings
from shortener.db import Database
from shortener.repository import LinkRepository, SqlLinkRepository


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_database(request: Request) -> Database:
    return cast(Database, request.app.state.db)


async def get_session(
    db: Annotated[Database, Depends(get_database)],
) -> AsyncIterator[AsyncSession]:
    async with db.session() as session:
        yield session


def get_repository(session: Annotated[AsyncSession, Depends(get_session)]) -> LinkRepository:
    return SqlLinkRepository(session)


SettingsDep = Annotated[Settings, Depends(get_settings)]
DatabaseDep = Annotated[Database, Depends(get_database)]
RepositoryDep = Annotated[LinkRepository, Depends(get_repository)]
