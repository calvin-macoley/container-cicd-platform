from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from shortener.repository import CodeConflictError, SqlLinkRepository

pytestmark = pytest.mark.integration


async def test_create_and_get_link(client: AsyncClient) -> None:
    created = await client.post("/api/links", json={"url": "https://example.com/x"})
    assert created.status_code == 201
    code = created.json()["code"]

    response = await client.get(f"/api/links/{code}")

    assert response.status_code == 200
    body = response.json()
    assert body["target_url"] == "https://example.com/x"
    assert body["click_count"] == 0
    assert body["last_clicked_at"] is None
    created_at = datetime.fromisoformat(body["created_at"])
    assert created_at.tzinfo is not None
    assert abs(datetime.now(UTC) - created_at) < timedelta(minutes=1)


async def test_create_with_alias_and_expiry_persists(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    expires = datetime.now(UTC) + timedelta(days=1)
    response = await client.post(
        "/api/links",
        json={"url": "https://example.com", "alias": "persist", "expires_at": expires.isoformat()},
    )
    assert response.status_code == 201

    async with engine.connect() as conn:
        row = (
            await conn.execute(text("SELECT code, expires_at FROM links WHERE code = 'persist'"))
        ).one()
    assert row.expires_at == expires


async def test_alias_conflict_returns_409(client: AsyncClient) -> None:
    payload = {"url": "https://example.com", "alias": "taken"}
    assert (await client.post("/api/links", json=payload)).status_code == 201
    assert (await client.post("/api/links", json=payload)).status_code == 409


async def test_concurrent_creates_of_same_alias_one_wins(client: AsyncClient) -> None:
    payload = {"url": "https://example.com", "alias": "race"}

    responses = await asyncio.gather(*(client.post("/api/links", json=payload) for _ in range(8)))

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [201] + [409] * 7


async def test_validation_error_does_not_touch_database(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    assert (await client.post("/api/links", json={"url": "nope"})).status_code == 422
    async with engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM links"))).scalar_one() == 0


async def test_expired_link_details_still_visible(client: AsyncClient, engine: AsyncEngine) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "expired"})
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE links SET expires_at = now() - interval '1 second' WHERE code = 'expired'")
        )

    response = await client.get("/api/links/expired")

    assert response.status_code == 200
    assert response.json()["is_expired"] is True


async def test_delete_link(client: AsyncClient, engine: AsyncEngine) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "bye"})

    assert (await client.delete("/api/links/bye")).status_code == 204
    assert (await client.delete("/api/links/bye")).status_code == 404
    assert (await client.get("/api/links/bye")).status_code == 404
    async with engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM links"))).scalar_one() == 0


async def test_get_missing_link_is_404(client: AsyncClient) -> None:
    assert (await client.get("/api/links/nothere")).status_code == 404


async def test_repository_raises_conflict_and_session_stays_usable(app: FastAPI) -> None:
    async with app.state.db.session() as session:
        repo = SqlLinkRepository(session)
        await repo.create("dupe1", "https://example.com", None)
        with pytest.raises(CodeConflictError):
            await repo.create("dupe1", "https://example.org", None)
        # The failed insert was rolled back; the session can keep working.
        assert (await repo.get("dupe1")) is not None
        assert (await repo.get("dupe1")).target_url == "https://example.com"  # type: ignore[union-attr]
