from __future__ import annotations

from httpx import AsyncClient


async def test_healthz_success(client: AsyncClient) -> None:
    response = await client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "x-request-id" in response.headers


async def test_healthz_method_not_allowed(client: AsyncClient) -> None:
    response = await client.post("/healthz")
    assert response.status_code == 405
