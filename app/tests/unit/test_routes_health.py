from __future__ import annotations

from fastapi import FastAPI
from httpx import AsyncClient

from tests.fakes import FakeDatabase


async def test_healthz_success(client: AsyncClient) -> None:
    response = await client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "x-request-id" in response.headers


async def test_healthz_method_not_allowed(client: AsyncClient) -> None:
    response = await client.post("/healthz")
    assert response.status_code == 405


async def test_readyz_success(client: AsyncClient, app: FastAPI) -> None:
    response = await client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
    assert app.state.db.pings == 1


async def test_readyz_database_unavailable(client: AsyncClient, app: FastAPI) -> None:
    app.state.db = FakeDatabase(healthy=False)

    response = await client.get("/readyz")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


async def test_healthz_never_touches_database(client: AsyncClient, app: FastAPI) -> None:
    app.state.db = FakeDatabase(healthy=False)

    assert (await client.get("/healthz")).status_code == 200
    assert app.state.db.pings == 0
