"""Persistence for links.

Services depend on the ``LinkRepository`` protocol; ``SqlLinkRepository`` is
the PostgreSQL implementation. Unit tests use an in-memory fake.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from sqlalchemy import delete, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shortener.models import Link

_CODE_UNIQUE_CONSTRAINT = "uq_links_code"


@dataclass(frozen=True, slots=True)
class LinkRecord:
    code: str
    target_url: str
    created_at: datetime
    expires_at: datetime | None
    click_count: int
    last_clicked_at: datetime | None


class CodeConflictError(Exception):
    """The code is already taken."""


class LinkRepository(Protocol):
    async def create(self, code: str, target_url: str, expires_at: datetime | None) -> LinkRecord:
        """Insert a link. Raises CodeConflictError if ``code`` exists."""
        ...

    async def get(self, code: str) -> LinkRecord | None:
        """Return the link (expired or not), or None."""
        ...

    async def resolve_and_count(self, code: str) -> str | None:
        """Atomically count a click on an unexpired link and return its target, else None."""
        ...

    async def delete(self, code: str) -> bool:
        """Delete the link; False if it did not exist."""
        ...


def _to_record(link: Link) -> LinkRecord:
    return LinkRecord(
        code=link.code,
        target_url=link.target_url,
        created_at=link.created_at,
        expires_at=link.expires_at,
        click_count=link.click_count,
        last_clicked_at=link.last_clicked_at,
    )


class SqlLinkRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, code: str, target_url: str, expires_at: datetime | None) -> LinkRecord:
        stmt = (
            insert(Link)
            .values(code=code, target_url=target_url, expires_at=expires_at)
            .returning(Link)
        )
        try:
            link = (await self.session.execute(stmt)).scalar_one()
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            # Rely on the unique constraint, not a read-before-insert, so
            # concurrent creates of the same alias cannot both succeed.
            if _CODE_UNIQUE_CONSTRAINT in str(exc.orig):
                raise CodeConflictError(code) from exc
            raise
        return _to_record(link)

    async def get(self, code: str) -> LinkRecord | None:
        link = (
            await self.session.execute(select(Link).where(Link.code == code))
        ).scalar_one_or_none()
        return None if link is None else _to_record(link)

    async def resolve_and_count(self, code: str) -> str | None:
        # One statement: no read-then-write race between concurrent clicks.
        # Expiry is checked against the database clock so every replica agrees.
        stmt = (
            update(Link)
            .where(Link.code == code)
            .where(or_(Link.expires_at.is_(None), Link.expires_at > func.now()))
            .values(click_count=Link.click_count + 1, last_clicked_at=func.now())
            .returning(Link.target_url)
            .execution_options(synchronize_session=False)
        )
        target = (await self.session.execute(stmt)).scalar_one_or_none()
        await self.session.commit()
        return target

    async def delete(self, code: str) -> bool:
        stmt = delete(Link).where(Link.code == code).returning(Link.id)
        deleted = (await self.session.execute(stmt)).scalar_one_or_none()
        await self.session.commit()
        return deleted is not None
