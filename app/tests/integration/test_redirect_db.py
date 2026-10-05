from __future__ import annotations

import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

pytestmark = pytest.mark.integration


async def test_redirect_and_click_count(client: AsyncClient) -> None:
    await client.post("/api/links", json={"url": "https://example.com/dest", "alias": "hop"})

    response = await client.get("/hop")

    assert response.status_code == 307
    assert response.headers["location"] == "https://example.com/dest"
    details = (await client.get("/api/links/hop")).json()
    assert details["click_count"] == 1
    assert details["last_clicked_at"] is not None


async def test_concurrent_clicks_are_all_counted(client: AsyncClient) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "busy"})

    responses = await asyncio.gather(*(client.get("/busy") for _ in range(25)))

    assert all(r.status_code == 307 for r in responses)
    assert (await client.get("/api/links/busy")).json()["click_count"] == 25


async def test_redirect_missing_is_404(client: AsyncClient) -> None:
    assert (await client.get("/absent")).status_code == 404


async def test_redirect_expired_is_404_and_not_counted(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "late"})
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE links SET expires_at = now() - interval '1 second' WHERE code = 'late'")
        )

    assert (await client.get("/late")).status_code == 404
    assert (await client.get("/api/links/late")).json()["click_count"] == 0


async def test_redirect_before_expiry_works(client: AsyncClient, engine: AsyncEngine) -> None:
    await client.post("/api/links", json={"url": "https://example.com", "alias": "soon"})
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE links SET expires_at = now() + interval '1 hour' WHERE code = 'soon'")
        )

    assert (await client.get("/soon")).status_code == 307
