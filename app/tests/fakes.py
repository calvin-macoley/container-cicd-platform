"""In-memory stand-ins for the database layer (unit tests only)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime

from shortener.repository import CodeConflictError, LinkRecord


def utcnow() -> datetime:
    return datetime.now(UTC)


class FakeLinkRepository:
    def __init__(self, clock: Callable[[], datetime] = utcnow) -> None:
        self.links: dict[str, LinkRecord] = {}
        self.clock = clock
        self.create_calls: list[str] = []
        self.resolve_calls: list[str] = []

    async def create(self, code: str, target_url: str, expires_at: datetime | None) -> LinkRecord:
        self.create_calls.append(code)
        if code in self.links:
            raise CodeConflictError(code)
        record = LinkRecord(
            code=code,
            target_url=target_url,
            created_at=self.clock(),
            expires_at=expires_at,
            click_count=0,
            last_clicked_at=None,
        )
        self.links[code] = record
        return record

    async def get(self, code: str) -> LinkRecord | None:
        return self.links.get(code)

    async def resolve_and_count(self, code: str) -> str | None:
        self.resolve_calls.append(code)
        record = self.links.get(code)
        now = self.clock()
        if record is None or (record.expires_at is not None and record.expires_at <= now):
            return None
        self.links[code] = replace(record, click_count=record.click_count + 1, last_clicked_at=now)
        return record.target_url

    async def get_active_target(self, code: str) -> str | None:
        record = self.links.get(code)
        if record is None or (record.expires_at is not None and record.expires_at <= self.clock()):
            return None
        return record.target_url

    async def delete(self, code: str) -> bool:
        return self.links.pop(code, None) is not None


class FakeDatabase:
    def __init__(self, healthy: bool = True) -> None:
        self.healthy = healthy
        self.pings = 0

    async def ping(self, within_seconds: float) -> bool:
        self.pings += 1
        return self.healthy

    async def dispose(self) -> None:
        return None
